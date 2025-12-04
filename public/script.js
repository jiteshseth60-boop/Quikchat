// public/script.js
const socket = io(); // same-origin recommended

// UI elements
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const switchCamBtn = document.getElementById("switchCamBtn");
const statusTop = document.getElementById("statusTop");
const timerDisplay = document.getElementById("timer");
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChat");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const genderSelect = document.getElementById("genderSelect");
const countrySelect = document.getElementById("countrySelect");
const nameInput = document.getElementById("nameInput");
const coinsVal = document.getElementById("coinsVal");
const uploadBtn = document.getElementById("uploadBtn");
const imageUpload = document.getElementById("imageUpload");
const stickerBtn = document.getElementById("stickerBtn");
const stickerInput = document.getElementById("stickerInput");
const localSticker = document.getElementById("localSticker");
const remoteSticker = document.getElementById("remoteSticker");
const privateBtn = document.getElementById("privateBtn");
const searchAnim = document.getElementById("searchAnim");
const localNameEl = document.getElementById("localName");

// state
let pc = null;
let localStream = null;
let remoteStream = null;
let timerInterval = null;
let seconds = 0;
let currentCam = "user";
let isMuted = false;
let videoOff = false;
let room = null;
let coins = 500; // demo starting coins
coinsVal.innerText = coins;
localNameEl.innerText = `(You)`;

// ICE config (include TURN if you have credentials)
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add TURN if/when you have it
  ]
};

function setStatus(t){ statusTop.innerText = t; }
function showSearchAnim(show){ searchAnim.style.display = show ? "block" : "none"; }

function startTimer(){
  stopTimer();
  seconds = 0;
  timerInterval = setInterval(()=> {
    seconds++;
    const m = String(Math.floor(seconds/60)).padStart(2,'0');
    const s = String(seconds%60).padStart(2,'0');
    timerDisplay.innerText = `${m}:${s}`;
  }, 1000);
}
function stopTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval = null; timerDisplay.innerText = "00:00"; }

function addChat(txt){
  const d=document.createElement('div');
  d.innerText = txt;
  d.style.margin='6px 0';
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function startLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    localVideo.srcObject = localStream;
    applyTrackStates();
    return localStream;
  } catch(e){
    alert("Camera & mic permission required");
    throw e;
  }
}

function applyTrackStates(){
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
  muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  videoBtn.innerText = videoOff ? "Video On" : "Video Off";
}

// Create or return existing RTCPeerConnection
function createPeerIfNeeded(){
  if (pc) return pc;
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      // send raw candidate object to server
      socket.emit("candidate", ev.candidate);
    }
  };

  pc.ontrack = (ev) => {
    remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : null;
    remoteVideo.srcObject = remoteStream;
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState;
    console.log("PC state", s);
    if (s === "connected") {
      setStatus("Connected");
      startTimer();
      nextBtn.disabled = false;
      disconnectBtn.disabled = false;
      showSearchAnim(false);
    } else if (["disconnected","failed","closed"].includes(s)) {
      stopTimer();
    }
    if (s === "closed") {
      try { pc.close(); } catch(e){}
      pc = null;
    }
  };

  // attach local tracks if present (avoid duplicates)
  if (localStream) {
    const existing = pc.getSenders().filter(s=>s.track);
    if (!existing.length) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }
  return pc;
}

// UI handlers
findBtn.onclick = async () => {
  try {
    setStatus("Searching partner...");
    showSearchAnim(true);
    findBtn.disabled = true;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;

    await startLocalStream();

    const opts = {
      gender: genderSelect.value,
      country: countrySelect.value,
      wantPrivate: false,
      coins,
      name: nameInput.value || null
    };

    socket.emit("findPartner", opts);
  } catch(e) {
    console.error(e);
    resetControls();
  }
};

privateBtn.onclick = async () => {
  if (coins < 100) { alert("Not enough coins for private call (100)."); return; }
  const ok = confirm("Spend 100 coins to enter private match? (Both users must choose private)");
  if (!ok) return;
  try {
    setStatus("Searching private partner...");
    showSearchAnim(true);
    findBtn.disabled = true;

    await startLocalStream();
    const opts = {
      gender: genderSelect.value,
      country: countrySelect.value,
      wantPrivate: true,
      coins,
      name: nameInput.value || null
    };
    socket.emit("findPartner", opts);
  } catch (e) { console.warn(e); resetControls(); }
};

nextBtn.onclick = () => { leaveAndFind(true); };
disconnectBtn.onclick = () => { leaveAndFind(false); };
muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); };
videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); };

switchCamBtn.onclick = async () => {
  currentCam = currentCam === "user" ? "environment" : "user";
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  await startLocalStream();
  if (pc && localStream) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    const newTrack = localStream.getVideoTracks()[0];
    if (sender && newTrack) sender.replaceTrack(newTrack).catch(()=>pc.addTrack(newTrack, localStream));
    else localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }
};

sendChatBtn.onclick = () => {
  const txt = (chatInput.value || "").trim();
  if (!txt) return;
  addChat("You: " + txt);
  socket.emit("chat", { text: txt, ts: Date.now() });
  chatInput.value = "";
};

// image send
uploadBtn.onclick = () => imageUpload.click();
imageUpload.onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    socket.emit("image", { data: r.result, name: f.name, ts: Date.now() });
    addChat("You sent an image");
  };
  r.readAsDataURL(f);
  imageUpload.value = "";
};

// sticker send
stickerBtn.onclick = () => stickerInput.click();
stickerInput.onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    localSticker.src = r.result; localSticker.hidden = false;
    socket.emit("sticker", { data: r.result, ts: Date.now() });
  };
  r.readAsDataURL(f);
  stickerInput.value = "";
};

async function leaveAndFind(rematch=false){
  try {
    if (room) {
      socket.emit("leave");
      room = null;
      if (pc) try { pc.close(); } catch(e) {}
      pc = null;
      remoteVideo.srcObject = null;
      stopTimer();
      setStatus("Disconnected");
    }
  } catch(e){ console.warn(e); }
  resetControls();
  if (rematch) setTimeout(()=> findBtn.click(), 350);
}

function resetControls(){
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  showSearchAnim(false);
  setStatus("Ready — click Find");
  stopTimer();
  addChat("Ready");
}

// socket handlers
socket.on("connect", () => {
  console.log("socket connected", socket.id);
  resetControls();
});

socket.on("waiting", () => {
  setStatus("Waiting for partner...");
  showSearchAnim(true);
});

socket.on("partnerFound", async (data) => {
  try {
    console.log("partnerFound", data);
    room = data.room;
    console.log("Room id:", room);

    // local coin deduction demo if private requested
    if (data.partnerMeta && data.partnerMeta.wantPrivate) {
      if (coins >= 100) {
        coins -= 100;
        coinsVal.innerText = coins;
        addChat("Private call started (100 coins spent).");
      }
    }

    await startLocalStream();
    const localPc = createPeerIfNeeded();

    // attach local tracks if not already
    if (localStream) {
      const senders = localPc.getSenders().filter(s=>s.track);
      if (!senders.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
    }

    if (data.initiator) {
      setStatus("Creating offer...");
      const offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
      socket.emit("offer", { sdp: offer.sdp, type: offer.type });
    } else {
      setStatus("Waiting for offer...");
    }

    showSearchAnim(false);
  } catch (e) {
    console.warn("partnerFound error", e);
  }
});

socket.on("offer", async (payload) => {
  try {
    await startLocalStream();
    const localPc = createPeerIfNeeded();
    if (localStream) {
      const senders = localPc.getSenders().filter(s=>s.track);
      if (!senders.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
    }

    // Defensive remote description handling
    if (payload && (payload.sdp || payload.type)) {
      await localPc.setRemoteDescription({ type: payload.type || "offer", sdp: payload.sdp });
    } else {
      console.warn("offer: payload missing sdp/type", payload);
    }

    const answer = await localPc.createAnswer();
    await localPc.setLocalDescription(answer);
    socket.emit("answer", { sdp: answer.sdp, type: answer.type });
    setStatus("Answer sent — connecting...");
  } catch (e) {
    console.warn("offer handler", e);
  }
});

socket.on("answer", async (payload) => {
  try {
    if (!pc) return;
    if (payload && (payload.sdp || payload.type)) {
      await pc.setRemoteDescription({ type: payload.type || "answer", sdp: payload.sdp });
    } else {
      console.warn("answer: payload missing sdp/type", payload);
    }
    setStatus("Connected (answered)");
  } catch (e) { console.warn(e); }
});

socket.on("candidate", async (payload) => {
  try {
    if (!pc) return;
    // server may forward {candidate: <obj>} or raw candidate object
    const cand = (payload && payload.candidate) ? payload.candidate : payload;
    if (!cand) return;
    await pc.addIceCandidate(new RTCIceCandidate(cand));
  } catch(e){ console.warn("candidate error", e); }
});

socket.on("chat", (m) => addChat("Partner: " + (m.text || "message")));
socket.on("image", (img) => {
  addChat("Partner sent an image:");
  const im = document.createElement('img');
  im.src = img.data;
  im.style.maxWidth = "220px";
  im.style.display = "block";
  im.style.margin = "8px 0";
  chatBox.appendChild(im); chatBox.scrollTop = chatBox.scrollHeight;
});
socket.on("sticker", (st) => {
  remoteSticker.src = st.data; remoteSticker.hidden = false;
});

socket.on("peer-left", () => {
  addChat("Partner left.");
  // close pc to cleanup and allow quick rematch
  if (pc) try { pc.close(); } catch(e){}
  pc = null;
  remoteVideo.srcObject = null;
  leaveAndFind(false);
});

socket.on("disconnect", () => {
  setStatus("Signaling disconnected");
  resetControls();
});

window.addEventListener("beforeunload", () => {
  try { socket.emit("leave"); } catch(e){}
  if (localStream) localStream.getTracks().forEach(t=>t.stop());
});

resetControls();
console.log("Client ready");
