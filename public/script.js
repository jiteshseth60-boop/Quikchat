// public/script.js
const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let isMuted = false;
let videoEnabled = true;

const constraints = { audio: true, video: { width: 640, height: 480 } };

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const statusSpan = document.getElementById('status');

function logStatus(t){
  statusSpan.textContent = t;
}

// get media
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
    ]
  };
  pc = new RTCPeerConnection(config);

  // add local tracks
  if (localStream) {
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  pc.ontrack = (e) => {
    // combine tracks into remote stream
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
      // allow next
      nextBtn.disabled = false;
      disconnectBtn.disabled = true;
    }
  };

  return pc;
}

// join queue
findBtn.onclick = async () => {
  try {
    findBtn.disabled = true;
    await startLocalStream();
    socket.emit('joinQueue');
    logStatus('Searching...');
  } catch (e) {
    findBtn.disabled = false;
  }
};

nextBtn.onclick = () => {
  // hangup current
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

function resetUI() {
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  partnerId = null;
  remoteVideo.srcObject = null;
}

// hangup and close pc
function hangup() {
  if (pc) {
    try { pc.close(); } catch (e) {}
    pc = null;
  }
}

// when paired
socket.on('paired', async (data) => {
  partnerId = data.partner;
  logStatus('Paired: ' + partnerId);
  nextBtn.disabled = false;
  disconnectBtn.disabled = false;
  muteBtn.disabled = false;
  videoBtn.disabled = false;

  // create pc and start negotiation from the side with "lower id" to avoid both creating offer
  await startLocalStream();
  createPeerConnection();

  // decide who creates offer: the socket id lexicographical rule
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

// incoming signals
socket.on('signal', async (msg) => {
  // msg: { from, type, payload }
  if (!msg || !msg.type) return;
  const from = msg.from;

  if (!pc) createPeerConnection();

  if (msg.type === 'offer') {
    partnerId = from;
    logStatus('Offer received');
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
    logStatus('Answer received');
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    } catch (err) {
      console.error(err);
    }
  } else if (msg.type === 'ice') {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
    } catch (err) {
      // ignore
    }
  }
});

// remote peer disconnect -> allow find again
socket.on('peer-disconnected', (data) => {
  if (!partnerId) return;
  if (data && data.id === partnerId) {
    logStatus('Partner disconnected');
    hangup();
    resetUI();
  }
});

// initial UI
resetUI();
logStatus('Idle');
