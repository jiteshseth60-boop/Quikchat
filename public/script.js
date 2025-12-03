// public/script.js - FINAL integrated client
// Works with server: joinQueue, joinQueue/leaveQueue/next, invitePrivate, acceptInvite, signal, chat-message, file-message, reportUser, upload endpoint

// Optional: paste your firebase config here (if using Firebase features later)
// const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." };
// initialize Firebase here if needed

const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let currentRoom = null; // for private
let isPrivate = false;
let isMuted = false;
let videoEnabled = true;

// UI refs (elements exist in index.html we provided)
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const statusSpan = document.getElementById('status');

const createPrivateBtn = document.getElementById('createPrivateRoom');
const joinPrivateBtn = document.getElementById('joinPrivateRoom');
const roomInput = document.getElementById('roomInput');
const reportBtn = document.getElementById('reportBtn');

const constraints = { audio: true, video: { width: 640, height: 480 } };
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ---- dynamic chat UI (built once) ----
let chatPanel, messagesEl, chatInput, chatSendBtn, fileInputBtn;

function createChatUI() {
  if (chatPanel) return;
  chatPanel = document.createElement('div');
  chatPanel.style.position = 'fixed';
  chatPanel.style.right = '10px';
  chatPanel.style.bottom = '100px';
  chatPanel.style.width = '300px';
  chatPanel.style.maxHeight = '50vh';
  chatPanel.style.background = 'rgba(255,255,255,0.95)';
  chatPanel.style.borderRadius = '10px';
  chatPanel.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
  chatPanel.style.display = 'flex';
  chatPanel.style.flexDirection = 'column';
  chatPanel.style.overflow = 'hidden';
  chatPanel.style.zIndex = '9999';

  messagesEl = document.createElement('div');
  messagesEl.style.flex = '1';
  messagesEl.style.padding = '8px';
  messagesEl.style.overflowY = 'auto';
  messagesEl.style.fontSize = '14px';

  const inputWrap = document.createElement('div');
  inputWrap.style.display = 'flex';
  inputWrap.style.padding = '6px';
  inputWrap.style.gap = '6px';

  chatInput = document.createElement('input');
  chatInput.placeholder = 'Type a message...';
  chatInput.style.flex = '1';
  chatInput.style.padding = '8px';
  chatInput.style.borderRadius = '6px';
  chatInput.style.border = '1px solid #ddd';

  chatSendBtn = document.createElement('button');
  chatSendBtn.textContent = 'Send';
  chatSendBtn.style.padding = '8px 10px';

  fileInputBtn = document.createElement('input');
  fileInputBtn.type = 'file';
  fileInputBtn.accept = 'image/*,audio/*';
  fileInputBtn.style.display = 'none';

  const attachBtn = document.createElement('button');
  attachBtn.textContent = '📎';
  attachBtn.style.padding = '8px 10px';

  attachBtn.onclick = () => fileInputBtn.click();
  fileInputBtn.onchange = handleFileSelected;

  inputWrap.appendChild(chatInput);
  inputWrap.appendChild(chatSendBtn);
  inputWrap.appendChild(attachBtn);

  chatPanel.appendChild(messagesEl);
  chatPanel.appendChild(inputWrap);
  document.body.appendChild(chatPanel);

  chatSendBtn.onclick = sendMessage;
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

function appendMessage(who, text, html=false) {
  if (!messagesEl) createChatUI();
  const div = document.createElement('div');
  div.style.marginBottom = '8px';
  div.style.wordBreak = 'break-word';
  if (who === 'me') {
    div.style.textAlign = 'right';
    div.innerHTML = `<small style="color:#666">You</small><div style="background:#e8f0ff;display:inline-block;padding:6px;border-radius:8px;margin-top:4px;">${html?text:escapeHtml(text)}</div>`;
  } else {
    div.style.textAlign = 'left';
    div.innerHTML = `<small style="color:#666">Partner</small><div style="background:#f3f3f3;display:inline-block;padding:6px;border-radius:8px;margin-top:4px;">${html?text:escapeHtml(text)}</div>`;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

// ---------------- media helpers ----------------
async function startLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    // enable controls after stream obtained
    muteBtn.disabled = false;
    videoBtn.disabled = false;
    return localStream;
  } catch (err) {
    alert('Camera/Mic access required. Allow permissions in browser.');
    throw err;
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection(ICE);

  // attach local tracks
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && partnerId) {
      socket.emit('signal', { to: partnerId, type: 'ice', payload: ev.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState || pc.iceConnectionState;
    console.log('PC state', state);
    if (state === 'connected') {
      logStatus('Connected');
    } else if (['disconnected','failed','closed'].includes(state)) {
      logStatus('Disconnected');
      resetAfterCall();
    }
  };

  return pc;
}

// ---- UI handlers (buttons) ----
function logStatus(t){ if(statusSpan) statusSpan.textContent = t; }

findBtn.onclick = async () => {
  isPrivate = false;
  currentRoom = null;
  try {
    await startLocalStream();
    socket.emit('joinQueue');
    logStatus('Searching...');
    findBtn.disabled = true;
    createChatUI();
  } catch(e) { findBtn.disabled = false; }
};

nextBtn.onclick = () => {
  hangup();
  socket.emit('next');
  logStatus('Searching next...');
  resetAfterCall();
};

disconnectBtn.onclick = () => {
  socket.emit('leaveQueue');
  hangup();
  resetAfterCall();
  logStatus('Idle');
};

muteBtn.onclick = () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
};

videoBtn.onclick = () => {
  if (!localStream) return;
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
  videoBtn.textContent = videoEnabled ? 'Video Off' : 'Video On';
};

// CREATE PRIVATE: this creates room id and invites partner when used
createPrivateBtn.onclick = async () => {
  // create a code for sharing (we will fill input)
  const id = Math.random().toString(36).substring(2,8).toUpperCase();
  roomInput.value = id;
  alert('Room ID created: ' + id + '\nYou can share this ID or use invite flow.');
};

// JOIN PRIVATE by id (manual)
joinPrivateBtn.onclick = async () => {
  try {
    await startLocalStream();
    const rid = roomInput.value.trim();
    if (!rid) return alert('Enter Room ID');
    socket.emit('joinPrivateRoom', { roomId: rid });
    isPrivate = true;
    currentRoom = rid;
    logStatus('Joining private room ' + rid);
    createChatUI();
  } catch(e){}
};

// REPORT button: reports partner to server
reportBtn.onclick = () => {
  if (!partnerId) return alert('No partner');
  socket.emit('reportUser', { target: partnerId });
  alert('Reported. Moderation will review.');
};

// ---- file upload handling ----
async function handleFileSelected(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (!partnerId) return alert('No partner connected');

  const form = new FormData();
  form.append('file', f);

  try {
    appendMessage('me', `Uploading ${f.name}...`);
    const res = await fetch('/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Upload failed');
    // send file-message to partner
    socket.emit('file-message', { to: partnerId, url: data.url, name: data.name, mime: f.type });
    appendMessage('me', `<a href="${data.url}" target="_blank">Sent: ${escapeHtml(data.name)}</a>`, true);
  } catch (err) {
    console.error(err);
    alert('Upload failed');
  } finally {
    ev.target.value = '';
  }
}

// send chat text
function sendMessage() {
  if (!partnerId) return alert('No partner connected');
  const txt = chatInput.value.trim();
  if (!txt) return;
  socket.emit('chat-message', { to: partnerId, text: txt });
  appendMessage('me', txt);
  chatInput.value = '';
}

// receive file message
socket.on('file-message', (msg) => {
  if (!msg) return;
  appendMessage('other', `<a href="${msg.url}" target="_blank">File: ${escapeHtml(msg.name)}</a>`, true);
});

// receive chat message
socket.on('chat-message', (msg) => {
  if (!msg) return;
  appendMessage('other', msg.text);
});

// --------- Invite flow (client side) ----------
async function inviteToPrivate() {
  if (!partnerId) return alert('No partner to invite');
  socket.emit('invitePrivate', { to: partnerId });
  logStatus('Invite sent to partner');
}

// Listen for incoming private invites
socket.on('privateInvite', ({ inviteId, from }) => {
  // show accept/decline prompt
  const ok = confirm(`User invites to Private Room. Accept?`);
  if (ok) {
    socket.emit('acceptInvite', { inviteId });
    logStatus('Accepted private invite...');
  } else {
    socket.emit('rejectInvite', { inviteId });
    logStatus('Rejected private invite');
  }
});

socket.on('inviteSent', ({ inviteId, to }) => {
  console.log('Invite recorded', inviteId, to);
});

socket.on('inviteFailed', (d) => {
  alert('Invite failed: ' + (d.reason || 'Unknown'));
});

// when server pairs privately (after acceptInvite)
socket.on('pairedPrivate', async ({ partner, roomId }) => {
  partnerId = partner;
  currentRoom = roomId;
  isPrivate = true;
  logStatus('Private paired: ' + partnerId + ' room:' + roomId);
  // start call flow
  await startLocalStream();
  createPeerConnection();
  const makeOffer = socket.id < partnerId;
  if (makeOffer) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: partnerId, type: 'offer', payload: offer });
    } catch (err) { console.error(err); }
  } else {
    logStatus('Waiting for offer...');
  }
});

// ---- Public pairing
socket.on('paired', async (data) => {
  partnerId = data.partner;
  isPrivate = false;
  currentRoom = null;
  logStatus('Paired public: ' + partnerId);
  createChatUI();
  await startLocalStream();
  createPeerConnection();
  const makeOffer = socket.id < partnerId;
  if (makeOffer) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: partnerId, type: 'offer', payload: offer });
    } catch (err) { console.error(err); }
  } else {
    logStatus('Waiting for offer...');
  }
});

// ---- Signaling incoming
socket.on('signal', async (msg) => {
  if (!msg) return;
  if (!pc) createPeerConnection();
  if (msg.type === 'offer') {
    partnerId = msg.from;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: partnerId, type: 'answer', payload: answer });
  } else if (msg.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
  } else if (msg.type === 'ice') {
    try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload)); } catch(e){}
  }
});

// partner disconnected
socket.on('partnerDisconnected', (d) => {
  if (d && d.id === partnerId) {
    appendMessage('other', 'Partner disconnected');
    hangup();
    resetAfterCall();
  }
});

// warned by server
socket.on('warned', () => {
  alert('You have been reported/warned by partner.');
});

// generic helpers
function hangup() {
  try { if (pc) pc.close(); } catch(e){}
  pc = null;
  partnerId = null;
  currentRoom = null;
  isPrivate = false;
}

function resetAfterCall() {
  hangup();
  logStatus('Idle');
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
}

// simple nudity/frame-check stub (replace with NSFW.js for production)
let nudityCheckInterval = null;
function startNudityCheck() {
  stopNudityCheck();
  // take a frame every 2s and do a very simple heuristic (brightness/skin pixels)
  nudityCheckInterval = setInterval(async () => {
    if (!remoteVideo || remoteVideo.readyState < 2) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = remoteVideo.videoWidth || 320;
      canvas.height = remoteVideo.videoHeight || 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0,0,canvas.width, canvas.height).data;
      // very naive: count bright-ish pixels ratio
      let bright = 0, tot = data.length/4;
      for (let i=0;i<data.length;i+=4) {
        const r=data[i], g=data[i+1], b=data[i+2];
        const lum = 0.2126*r + 0.7152*g + 0.0722*b;
        if (lum > 200) bright++;
      }
      const ratio = bright / tot;
      // if frame too bright large ratio => possible nudity/skin exposure heuristic
      if (ratio > 0.22) {
        console.log('Possible nudity heuristic detected ratio', ratio);
        // report partner (server will warn and optionally ban)
        if (partnerId) {
          socket.emit('reportUser', { target: partnerId });
          appendMessage('me', 'Automatic report sent due to policy violation.');
        }
      }
    } catch (e){ console.error(e); }
  }, 3000);
}
function stopNudityCheck(){ if (nudityCheckInterval) clearInterval(nudityCheckInterval); nudityCheckInterval=null; }

// start/stop nudity check on connection
// when connected, start checks for public calls only
socket.on('paired', () => startNudityCheck());
socket.on('pairedPrivate', () => stopNudityCheck()); // private rooms allowed

// ---- file chooser attach (createChatUI created file input)
document.addEventListener('click', () => {
  // ensure fileInput exists after UI creation
  if (!chatPanel) createChatUI();
});

// ensure user can invite partner to private room via keyboard: 'i' key
document.addEventListener('keydown', (e) => {
  if (e.key === 'i' || e.key === 'I') {
    invitePrompt();
  }
});

function invitePrompt(){
  if (!partnerId) return alert('No partner to invite');
  if (!confirm('Invite this partner to a private room? (if accepted, you will move to private)')) return;
  socket.emit('invitePrivate', { to: partnerId });
  logStatus('Invite sent...');
}

// when someone rejected your invite
socket.on('inviteRejected', ({ inviteId, by }) => {
  alert('Your invite was rejected by partner.');
  logStatus('Invite rejected');
});

// when your invite is accepted, server will emit pairedPrivate which starts flow
socket.on('inviteSent', (d) => {
  logStatus('Invite sent (waiting) ...');
});

// ---- helper: escape/encode urls
function absoluteUrl(path){ 
  // if path already full url return, else build from current origin
  if (!path) return path;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${location.origin}${path}`;
}

// auto-create chat UI on load (hidden until used)
createChatUI();

// expose small debug in console
window.__qc = {
  socket, startLocalStream, createPeerConnection, hangup
};

logStatus('Idle');
