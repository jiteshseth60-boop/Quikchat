// public/script.js
const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let isMuted = false;
let videoEnabled = true;
let currentRoom = null;
let isPrivate = false;

const constraints = { audio: true, video: { width: 640, height: 480 } };

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const statusSpan = document.getElementById('status');

const createPrivateBtn = document.getElementById("createPrivateRoom");
const joinPrivateBtn = document.getElementById("joinPrivateRoom");
const roomInput = document.getElementById("roomInput");
const reportBtn = document.getElementById("reportBtn");

function logStatus(t){
  statusSpan.textContent = t;
}

async function startLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    return localStream;
  } catch (err) {
    alert('Camera/Mic access required. Enable from browser settings.');
    throw err;
  }
}

function createPeerConnection() {
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };
  pc = new RTCPeerConnection(config);

  if (localStream) {
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  pc.ontrack = (e) => remoteVideo.srcObject = e.streams[0];

  pc.onicecandidate = (event) => {
    if (event.candidate && partnerId) {
      socket.emit('signal', { to: partnerId, type: 'ice', payload: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState || pc.iceConnectionState;
    logStatus("Connection: " + s);
    if (["disconnected","failed","closed"].includes(s)) {
      nextBtn.disabled = false;
      disconnectBtn.disabled = true;
    }
  };

  return pc;
}

// PUBLIC RANDOM MATCH
findBtn.onclick = async () => {
  isPrivate = false;
  currentRoom = null;
  try {
    await startLocalStream();
    socket.emit('joinQueue');
    logStatus("Searching...");
    findBtn.disabled = true;
  } catch {}
};

nextBtn.onclick = () => {
  hangup();
  socket.emit('next');
  logStatus("Searching next...");
};

disconnectBtn.onclick = () => {
  socket.emit('leaveQueue');
  hangup();
  resetUI();
  logStatus("Idle");
};

// PRIVATE ROOM ---->
createPrivateBtn.onclick = async () => {
  await startLocalStream();
  const roomID = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomInput.value = roomID;
  socket.emit("createRoom", roomID);
  isPrivate = true;
  currentRoom = roomID;
  logStatus("Room Created: " + roomID + " Share with friend");
};

joinPrivateBtn.onclick = async () => {
  await startLocalStream();
  const roomID = roomInput.value.trim();
  if (!roomID) return alert("Enter Room ID");
  socket.emit("joinRoom", roomID);
  isPrivate = true;
  currentRoom = roomID;
  logStatus("Joining Room: " + roomID + "...");
};

// REPORT USER
reportBtn.onclick = () => {
  if (!partnerId) return alert("No partner connected");
  socket.emit("reportUser", partnerId);
  alert("User Reported. Our AI moderation will review.");
};

// CONTROLS
muteBtn.onclick = () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.textContent = isMuted ? "Unmute" : "Mute";
};

videoBtn.onclick = () => {
  if (!localStream) return;
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
  videoBtn.textContent = videoEnabled ? "Video Off" : "Video On";
};

function resetUI() {
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  remoteVideo.srcObject = null;
  partnerId = null;
}

function hangup() {
  if (pc) pc.close();
  pc = null;
}

// PAIRING FOR BOTH RANDOM + PRIVATE
socket.on('paired', async (data) => {
  partnerId = data.partner;
  logStatus("Connected: " + partnerId);

  nextBtn.disabled = false;
  disconnectBtn.disabled = false;
  muteBtn.disabled = false;
  videoBtn.disabled = false;

  await startLocalStream();
  createPeerConnection();

  const makeOffer = socket.id < partnerId;
  if (makeOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: partnerId, type: "offer", payload: offer });
  }
});

// SIGNALS
socket.on("signal", async (msg) => {
  if (!pc) createPeerConnection();
  if (msg.type === "offer") {
    partnerId = msg.from;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: partnerId, type: "answer", payload: answer });
  } else if (msg.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
  } else if (msg.type === "ice") {
    try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload)); } catch {}
  }
});

// DISCONNECT
socket.on("peer-disconnected", (data) => {
  if (data.id === partnerId) {
    logStatus("Partner left");
    hangup();
    resetUI();
  }
});

resetUI();
logStatus("Idle");
