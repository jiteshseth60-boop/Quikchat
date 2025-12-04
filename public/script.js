// public/script.js — FINAL QuikChat (Glass UI)

// ---- Firebase ----
const firebaseConfig = {
  apiKey: "AIzaSyAy0IElrucTOCS9-PaYair8fa0xZIxwJM0",
  authDomain: "quikchat12.firebaseapp.com",
  projectId: "quikchat12",
  storageBucket: "quikchat12.firebasestorage.app",
  messagingSenderId: "121839577232",
  appId: "1:121839577232:web:589e7831fdaa9d72205015"
};
firebase.initializeApp(firebaseConfig);

// ---- socket.io ----
const socket = io("https://quikchat-global.onrender.com", {
  transports: ["websocket"]
});

let localStream = null;
let pc = null;
let partnerId = null;
let callTimer = null;
let seconds = 0;

// UI refs
const startOverlay = document.getElementById('startOverlay');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const genderInput = document.getElementById('genderInput');
const countryInput = document.getElementById('countryInput');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const sendBtn = document.getElementById('sendBtn');
const messageInput = document.getElementById('messageInput');
const messagesEl = document.getElementById('messages');
const imageInput = document.getElementById('imageInput');
const musicInput = document.getElementById('musicInput');
const coinValueEl = document.getElementById('coinValue');
const statusEl = document.getElementById('status');
const pairIdEl = document.getElementById('pairId');
const timerEl = document.getElementById('timer');

// ---- helpers ----
function logStatus(t) { statusEl.textContent = t; console.log('[status]', t); }

async function startLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  return localStream;
}

function startCallTimer() {
  clearInterval(callTimer); seconds = 0; timerEl.textContent = '00:00';
  callTimer = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function hangupCleanup() {
  try { pc.close(); } catch { }
  pc = null; partnerId = null;
  clearInterval(callTimer); seconds = 0; timerEl.textContent = "00:00";
  remoteVideo.srcObject = null;
}

function resetUIAfterHangup() {
  hangupCleanup();
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  pairIdEl.textContent = '';
  logStatus('Idle');
}

function createPeerConnection() {
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.ontrack = (ev) => { remoteVideo.srcObject = ev.streams[0]; };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && partnerId) {
      socket.emit('signal', { to: partnerId, type: 'ice', payload: ev.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      resetUIAfterHangup();
    }
  };

  return pc;
}

// ---- button events ----
startBtn.onclick = async () => {
  startOverlay.style.display = 'none';
  await startLocalStream();
  logStatus('Ready - Click Find');
};

findBtn.onclick = async () => {
  findBtn.disabled = true;
  await startLocalStream();
  socket.emit('joinQueue', { gender: genderInput.value, country: countryInput.value });
  logStatus("Searching...");
};

nextBtn.onclick = () => {
  socket.emit("next");
  resetUIAfterHangup();
  logStatus("Searching next...");
};

disconnectBtn.onclick = () => {
  socket.emit("leaveQueue");
  resetUIAfterHangup();
};

muteBtn.onclick = () => {
  const t = localStream.getAudioTracks();
  t.forEach(x => x.enabled = !x.enabled);
  muteBtn.textContent = t[0].enabled ? "Mute" : "Unmute";
};

videoBtn.onclick = () => {
  const t = localStream.getVideoTracks();
  t.forEach(x => x.enabled = !x.enabled);
  videoBtn.textContent = t[0].enabled ? "Video Off" : "Video On";
};

sendBtn.onclick = () => {
  const txt = messageInput.value.trim();
  if (!txt || !partnerId) return;
  socket.emit("signal", { to: partnerId, type: "msg", payload: { text: txt, name: nameInput.value || "You" } });
  appendMessage({ fromName: "You", text: txt, me: true });
  messageInput.value = "";
};

// ---- messaging ----
function appendMessage({ fromName = "Stranger", text = "", me = false }) {
  const wrap = document.createElement("div");
  wrap.className = "bubble " + (me ? "me" : "other");
  const title = document.createElement("div"); title.className = "bubble-title"; title.textContent = fromName;
  wrap.appendChild(title);
  const p = document.createElement("div"); p.textContent = text; wrap.appendChild(p);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- socket events ----
socket.on('paired', async (d) => {
  partnerId = d.partner;
  pairIdEl.textContent = "Paired " + partnerId;
  logStatus("Paired");
  nextBtn.disabled = false;
  disconnectBtn.disabled = false;
  muteBtn.disabled = false;
  videoBtn.disabled = false;
  messagesEl.innerHTML = "";
  startCallTimer();
  await startLocalStream();
  createPeerConnection();
  const makeOffer = socket.id < partnerId;
  if (makeOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: partnerId, type: 'offer', payload: offer });
  }
});

socket.on('signal', async (msg) => {
  if (!msg || !msg.type) return;
  if (!pc && ["offer", "answer", "ice"].includes(msg.type)) {
    await startLocalStream(); createPeerConnection();
  }
  if (msg.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit('signal', { to: msg.from, type: "answer", payload: ans });
  } else if (msg.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
  } else if (msg.type === "ice") {
    await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
  } else if (msg.type === "msg") {
    appendMessage({ fromName: msg.payload.name, text: msg.payload.text });
  }
});

socket.on('peer-disconnected', () => {
  logStatus("Partner disconnected");
  resetUIAfterHangup();
});

// init
resetUIAfterHangup();
logStatus("Idle");
