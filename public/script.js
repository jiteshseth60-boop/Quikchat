// script.js - QuikChat client
// Requirements: socket.io served at /socket.io/socket.io.js (server.js already does)
// Optional: window.FIREBASE_CONFIG if you want Firebase features (not used heavily here)

let userName = "";
let userGender = "";
let isPrivateMode = false;

function startApp(){
  const nameInput = document.getElementById('nameInput');
  const genderInput = document.getElementById('genderInput');

  userName = (nameInput && nameInput.value.trim()) || "Anonymous";
  userGender = (genderInput && genderInput.value) || "";
  document.getElementById('startOverlay').style.display = 'none';

  // small UI tweak: show name in topbar
  const h = document.querySelector('.topbar h1');
  if(h) h.textContent = `QuikChat — ${userName}${userGender ? ' · ' + userGender : ''}`;
}

// --- socket and WebRTC ---
const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let isMuted = false;
let videoEnabled = true;
const constraints = { audio: true, video: { width: 640, height: 480 } };

// UI refs
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const statusSpan = document.getElementById('status');
const sendBtn = document.getElementById('sendBtn');
const messageInput = document.getElementById('messageInput');
const messagesEl = document.getElementById('messages');
const coinValueEl = document.getElementById('coinValue');
const imageInput = document.getElementById('imageInput');
const musicInput = document.getElementById('musicInput');
const privateBtn = document.getElementById('privateBtn');

function logStatus(t){ if(statusSpan) statusSpan.textContent = t; }

async function startLocalStream(){
  if(localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if(localVideo) localVideo.srcObject = localStream;
    return localStream;
  }catch(err){
    alert('Camera/Mic access required. Check permissions.');
    throw err;
  }
}

function createPeerConnection(){
  const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  pc = new RTCPeerConnection(config);

  // add local tracks
  if(localStream){
    for(const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  pc.ontrack = (e) => {
    if(remoteVideo) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (event) => {
    if(event.candidate && partnerId){
      socket.emit('signal', { to: partnerId, type: 'ice', payload: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if(!pc) return;
    const s = pc.connectionState || pc.iceConnectionState;
    logStatus('PC: ' + s);
    if(s === 'disconnected' || s === 'failed' || s === 'closed'){
      nextBtn.disabled = false;
      disconnectBtn.disabled = true;
    }
  };

  return pc;
}

function hangup(){
  if(pc){ try{ pc.close(); }catch(e){} pc = null; }
  if(remoteVideo) remoteVideo.srcObject = null;
  partnerId = null;
}

// queue actions
findBtn.onclick = async () => {
  try{
    findBtn.disabled = true;
    await startLocalStream();
    socket.emit('joinQueue', { name: userName, gender: userGender, private: isPrivateMode });
    logStatus('Searching...');
  }catch(e){
    findBtn.disabled = false;
  }
};

nextBtn.onclick = () => {
  hangup();
  socket.emit('next');
  findBtn.disabled = true;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  logStatus('Searching next...');
};

disconnectBtn.onclick = () => {
  socket.emit('leaveQueue');
  hangup();
  resetUI();
  logStatus('Idle');
};

muteBtn.onclick = () => {
  if(!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
};

videoBtn.onclick = () => {
  if(!localStream) return;
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
  videoBtn.textContent = videoEnabled ? 'Video Off' : 'Video On';
};

privateBtn.onclick = () => {
  isPrivateMode = !isPrivateMode;
  privateBtn.textContent = isPrivateMode ? 'Private (on)' : '🔒 Private';
};

// reset UI
function resetUI(){
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  partnerId = null;
  if(remoteVideo) remoteVideo.srcObject = null;
}

// messaging
sendBtn.onclick = () => {
  const text = messageInput.value.trim();
  if(!text || !partnerId) return;
  const msg = { text, from: socket.id, name: userName };
  appendMessage('me', userName, text);
  socket.emit('chat', { to: partnerId, payload: msg });
  messageInput.value = '';
};

function appendMessage(type, name, text){
  const d = document.createElement('div');
  d.className = 'message';
  d.innerHTML = `<div class="bubble ${type==='me'?'me':'other'}"><strong>${name}</strong><div style="font-size:14px;margin-top:6px">${text}</div></div>`;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// image and music sending
imageInput.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if(!f || !partnerId) return;
  // simple client-side check for nudity (NOT reliable). Replace with server-side moderation.
  const blocked = await simpleImageHeuristicBlock(f);
  if(blocked){
    alert('Image blocked by moderation policy (public).');
    return;
  }
  const data = await fileToDataURL(f);
  socket.emit('file', { to: partnerId, type: 'image', name: f.name, data });
  appendMessage('me', userName, `📷 image sent`);
  e.target.value = '';
};

musicInput.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if(!f || !partnerId) return;
  const data = await fileToDataURL(f);
  socket.emit('file', { to: partnerId, type: 'audio', name: f.name, data });
  appendMessage('me', userName, `🎵 audio sent`);
  e.target.value = '';
};

function fileToDataURL(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// simple heuristic - very basic and not a replacement for automated moderation
async function simpleImageHeuristicBlock(file){
  // block very small files? (this is only placeholder)
  if(file.size > 5 * 1024 * 1024) return false; // large file likely not blocked here
  // try to analyze image ratio - (NOT reliable)
  const url = await fileToDataURL(file);
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;
      // if image is very tall or very narrow, allow; if near 1:1 or wide, can't decide -> allow
      // THIS IS A STUB: returns false (don't block) by default.
      res(false);
    };
    img.onerror = () => res(false);
    img.src = url;
  });
}

// socket handlers for pairing and signaling
socket.on('paired', async (data) => {
  partnerId = data.partner;
  logStatus('Paired: ' + partnerId);
  nextBtn.disabled = false;
  disconnectBtn.disabled = false;
  muteBtn.disabled = false;
  videoBtn.disabled = false;

  await startLocalStream();
  createPeerConnection();

  const makeOffer = socket.id < partnerId;
  if(makeOffer){
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: partnerId, type: 'offer', payload: offer });
      logStatus('Offer sent');
    }catch(err){ console.error(err); }
  } else {
    logStatus('Waiting for offer...');
  }
});

socket.on('signal', async (msg) => {
  if(!msg || !msg.type) return;
  const from = msg.from;

  if(!pc) createPeerConnection();

  if(msg.type === 'offer'){
    partnerId = from;
    logStatus('Offer received');
    try{
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, type: 'answer', payload: answer });
      logStatus('Answer sent');
    }catch(err){ console.error(err); }
  } else if(msg.type === 'answer'){
    logStatus('Answer received');
    try{
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    }catch(err){ console.error(err); }
  } else if(msg.type === 'ice'){
    try{ await pc.addIceCandidate(new RTCIceCandidate(msg.payload)); }catch(err){}
  }
});

// chat incoming
socket.on('chat', (m) => {
  if(!m || !m.payload) return;
  const p = m.payload;
  appendMessage('other', p.name || 'Stranger', p.text || '');
});

// file incoming
socket.on('file', (m) => {
  if(!m || !m.payload) return;
  const p = m.payload;
  if(p.type === 'image'){
    const el = document.createElement('div');
    el.innerHTML = `<div class="bubble other"><strong>${p.name}</strong><div style="margin-top:6px"><img src="${p.data}" style="max-width:220px;border-radius:8px;display:block"></div></div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }else if(p.type === 'audio'){
    const el = document.createElement('div');
    el.innerHTML = `<div class="bubble other"><strong>${p.name}</strong><div style="margin-top:6px"><audio controls src="${p.data}"></audio></div></div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
});

// peer disconnected
socket.on('peer-disconnected', (data) => {
  if(!partnerId) return;
  if(data && data.id === partnerId){
    logStatus('Partner disconnected');
    hangup();
    resetUI();
  }
});

// coin update (server can emit)
socket.on('coins', (c) => {
  if(coinValueEl) coinValueEl.textContent = c || 0;
});

// private invite handling
socket.on('private-invite', (payload) => {
  // payload: { from, roomId }
  // implement acceptance flow if needed
  if(confirm('Private invite received. Accept?')){
    socket.emit('private-accept', { to: payload.from, roomId: payload.roomId });
  } else {
    socket.emit('private-decline', { to: payload.from });
  }
});

// UI initial
resetUI();
logStatus('Idle');

// optional: initialize firebase if present
if(window.FIREBASE_CONFIG && typeof firebase !== 'undefined'){
  try{
    firebase.initializeApp(window.FIREBASE_CONFIG);
    // later you can use firebase.auth(), firestore, storage for moderation / file upload etc.
    console.log('Firebase initialized');
  }catch(e){}
}
