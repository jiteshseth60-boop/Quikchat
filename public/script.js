// script.js// script.js

let userName = "";
let userGender = "";

function startApp() {
  document.getElementById("startOverlay").style.display = "none";
  userName = document.getElementById("username").value;
  userGender = document.getElementById("gender").value;
}

const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let isMuted = false;
let videoEnabled = true;
const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let isMuted = false;
let videoEnabled = true;
const constraints = { audio: true, video: { width: 640, height: 480 } };

// UI
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const statusSpan = document.getElementById('status');

const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

const imageInput = document.getElementById('imageInput');
const musicInput = document.getElementById('musicInput');
const coinValueEl = document.getElementById('coinValue');
const privateBtn = document.getElementById('privateBtn');

let coins = 0;
let nudityRejects = 0;

function logStatus(t){ statusSpan.textContent = t; }

// --- basic media handling
async function startLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    return localStream;
  } catch (err) {
    alert('Camera/Mic access required. Check permissions.');
    throw err;
  }
}

function createPeerConnection() {
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
      // add TURN if you have one here
    ]
  };
  pc = new RTCPeerConnection(config);

  if (localStream) {
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && partnerId) {
      socket.emit('signal', { to: partnerId, type: 'ice', payload: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState || pc.iceConnectionState;
    logStatus('PC: ' + s);
    if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      nextBtn.disabled = false;
      disconnectBtn.disabled = true;
    }
  };

  return pc;
}

function resetUI() {
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  partnerId = null;
  remoteVideo.srcObject = null;
  logStatus('Idle');
}

// hangup
function hangup() {
  if (pc) {
    try{ pc.close(); }catch(e){}
    pc = null;
  }
}

// pairing
findBtn.onclick = async () => {
  try {
    findBtn.disabled = true;
    await startLocalStream();
    socket.emit('joinQueue');
    logStatus('Searching...');
  } catch(e) {
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

// send text
sendBtn.onclick = sendMessage;
messageInput.addEventListener('keypress', (e)=>{
  if (e.key === 'Enter') sendMessage();
});
function sendMessage(){
  const text = messageInput.value.trim();
  if (!text || !partnerId) return;
  const meta = { kind: 'text', time: Date.now() };
  addBubble('me', text, meta);
  socket.emit('send-message', { to: partnerId, msg: text, meta });
  messageInput.value = '';
}

// add message bubble
function addBubble(who, text, meta) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message';
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (who === 'me' ? 'me' : 'other');
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// incoming messages
socket.on('receive-message', ({ from, msg, meta }) => {
  addBubble('other', msg, meta);
});

// pairing from server
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
  if (makeOffer) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: partnerId, type: 'offer', payload: offer });
      logStatus('Offer sent');
    } catch (err) {
      console.error(err);
    }
  } else {
    logStatus('Waiting for offer...');
  }
});

// generic signals
socket.on('signal', async (msg) => {
  if (!msg || !msg.type) return;
  const from = msg.from;
  if (!pc) createPeerConnection();

  if (msg.type === 'offer') {
    partnerId = from;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, type: 'answer', payload: answer });
      logStatus('Answer sent');
    } catch (err) {
      console.error(err);
    }
  } else if (msg.type === 'answer') {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      logStatus('Connected');
    } catch (err) { console.error(err); }
  } else if (msg.type === 'ice') {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
    } catch (err) { /* ignore */ }
  }
});

// peer disconnected
socket.on('peer-disconnected', (data) => {
  if (!partnerId) return;
  if (data && data.id === partnerId) {
    logStatus('Partner disconnected');
    hangup();
    resetUI();
  }
});

// --- IMAGE / MUSIC upload handling ---
imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !partnerId) { e.target.value=''; return; }

  // preview + nudity check
  const isNude = await detectNudityInImage(file);
  if (isNude) {
    nudityRejects++;
    alert('Image looks explicit — blocked in public chat.');
    e.target.value='';
    return;
  }

  // upload as dataURL and send as message meta (small images OK; for large, use storage)
  const dataUrl = await toDataURL(file);
  const meta = { kind:'image', name:file.name, url:dataUrl, time:Date.now() };
  addImageBubble('me', dataUrl, meta);
  socket.emit('send-message',{ to: partnerId, msg:'[image]', meta });
  e.target.value='';
});

musicInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !partnerId) { e.target.value=''; return; }

  // convert to blob URL for playback & download
  const url = URL.createObjectURL(file);
  const meta = { kind:'audio', name:file.name, url, time:Date.now() };
  addAudioBubble('me', meta);
  socket.emit('send-message',{ to: partnerId, msg:'[audio]', meta });
  e.target.value='';
});

function addImageBubble(who, url, meta){
  const wrapper = document.createElement('div');
  wrapper.className='message';
  const bubble = document.createElement('div');
  bubble.className='bubble ' + (who === 'me' ? 'me':'other');
  const img = document.createElement('img');
  img.src = url;
  img.style.maxWidth='260px';
  img.style.borderRadius='10px';
  bubble.appendChild(img);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addAudioBubble(who, meta){
  const wrapper = document.createElement('div');
  wrapper.className='message';
  const bubble = document.createElement('div');
  bubble.className='bubble ' + (who === 'me' ? 'me':'other');
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = meta.url;
  bubble.appendChild(audio);
  // download link
  const a = document.createElement('a');
  a.href = meta.url;
  a.download = meta.name || 'audio';
  a.textContent = 'Download';
  a.style.display='block';
  a.style.marginTop='6px';
  bubble.appendChild(a);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// receive image/audio messages
socket.on('receive-message', ({ from, msg, meta }) => {
  if (!meta) return addBubble('other', msg, {time:Date.now()});
  if (meta.kind === 'image') addImageBubble('other', meta.url, meta);
  else if (meta.kind === 'audio') addAudioBubble('other', meta);
  else addBubble('other', msg, meta);
});

// helpers
function toDataURL(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// -------------------- Nudity heuristic --------------------
// Very simple skin-tone ratio detector (client-side). Not perfect.
// Scans the image at reduced size, counts pixels within a skin-like HSV range.
// If ratio > threshold => block. This helps reduce obvious explicit images in public chat.
// Replace with proper moderation API for production.
async function detectNudityInImage(file){
  const img = new Image();
  const dataUrl = await toDataURL(file);
  return new Promise((resolve) => {
    img.onload = () => {
      // draw reduced canvas
      const W = 120;
      const H = Math.round((img.height/img.width)*W);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const pixels = ctx.getImageData(0,0,W,H).data;
      let skin = 0;
      let total = 0;
      for (let i=0;i<pixels.length;i+=4){
        const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
        total++;
        // convert to HSV-ish / simple skin rules in RGB space
        // heuristic: r > 95 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15
        if (r > 95 && g > 40 && b > 20 && (r > g) && (r > b) && (r - g) > 15) skin++;
      }
      const ratio = skin / total;
      // threshold conservative: 0.15 => if >15% pixels skin-like, reject
      resolve(ratio > 0.15);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

// -------------------- Private room flow --------------------
privateBtn.onclick = async () => {
  if (!partnerId) { alert('No partner to invite'); return; }
  if (!confirm('Invite partner to a private room? This will ask them to accept.')) return;
  socket.emit('private-request', { to: partnerId });
  alert('Private room invitation sent to partner.');
};

// when receiving private request
socket.on('private-request', ({ from }) => {
  if (!confirm('User wants a private room. Accept?')) {
    // ignore
  } else {
    // accept and notify
    socket.emit('private-accept', { to: from });
    // optional: mark private mode (UI changes)
    alert('Private room accepted. Coins will start when private session begins.');
    // coin deduction logic can be started here
  }
});

// when other accepts our private invite
socket.on('private-accept', ({ from }) => {
  if (from === partnerId) {
    alert('Partner accepted private room. Starting private session.');
    // start coin deduction or mark UI
  }
});

// -------------------- Init UI --------------------
resetUI();
logStatus('Idle');

// optional: if you want to pre-init firebase and use storage (not required)
if (window.FIREBASE_CONFIG) {
  // dynamic init (left as placeholder)
  console.log('Firebase config detected (not auto used).');
}

/* End script.js */
