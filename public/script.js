// SOCKET
const socket = io();

// GLOBALS
let pc = null;
let localStream = null;
let remoteStream = null;
let partnerId = null;
let mediaRecorder = null;

// UI ELEMENTS
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const switchCamBtn = document.getElementById("switchCamBtn");

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const messagesEl = document.getElementById("messages");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const statusEl = document.getElementById("status");
const coinValueEl = document.getElementById("coinValue");
const filePicker = document.getElementById("filePicker");

// BUTTON HANDLERS
findBtn.onclick = () => socket.emit("find");
nextBtn.onclick = () => socket.emit("next");
disconnectBtn.onclick = () => hangup();
muteBtn.onclick = () => toggleMute();
videoBtn.onclick = () => toggleVideo();
switchCamBtn.onclick = () => switchCamera();

filePicker.onchange = sendFile;

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if(!msg) return;
  socket.emit("chat", { text: msg });
  appendMessage("me", "You", msg);
  chatInput.value = "";
});

// UI RESET
function resetUI(){
  partnerId = null;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  switchCamBtn.disabled = true;
}

// STATUS LOG
function logStatus(t){
  if(statusEl) statusEl.textContent = t;
}

// CREATE PEER CONNECTION
function createPeerConnection(){
  pc = new RTCPeerConnection({
    iceServers:[
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  pc.onicecandidate = (e)=>{
    if(e.candidate){
      socket.emit("signal", { to: partnerId, type:"ice", payload:e.candidate });
    }
  };

  pc.ontrack = (ev)=>{
    if(!remoteStream){
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
    }
    remoteStream.addTrack(ev.track);
  };

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
}

// START LOCAL STREAM
async function startLocalStream(){
  if(localStream) return;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    localVideo.srcObject = localStream;
    switchCamBtn.disabled = false;
  }catch(err){
    console.error(err);
    alert("Camera/Mic permission blocked!");
  }
}

// HANGUP
function hangup(){
  if(pc){
    pc.close();
    pc = null;
  }
  if(remoteStream){
    remoteStream.getTracks().forEach(t=>t.stop());
  }
  partnerId = null;
  remoteStream = null;
  remoteVideo.srcObject = null;
  logStatus("Disconnected");
  resetUI();
}

// TOGGLE MIC
function toggleMute(){
  if(!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
}

// TOGGLE VIDEO
function toggleVideo(){
  if(!localStream) return;
  localStream.getVideoTracks().forEach(t => t.enabled = !t.enabled);
}

// SWITCH CAMERA
async function switchCamera(){
  if(!localStream) return;
  const cam = localStream.getVideoTracks()[0];
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: cam.getSettings().facingMode === "user" ? "environment" : "user" },
    audio:true
  });
  const newTrack = newStream.getVideoTracks()[0];
  localStream.removeTrack(cam);
  localStream.addTrack(newTrack);
  if(pc){
    const sender = pc.getSenders().find(s=>s.track && s.track.kind==="video");
    if(sender) sender.replaceTrack(newTrack);
  }
}

// MESSAGES UI
function appendMessage(side,name,msg){
  const el = document.createElement("div");
  el.className = `bubble ${side}`;
  el.innerHTML = `<strong>${name}:</strong> ${msg}`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// FILE TO BASE64
function fileToDataURL(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// SEND FILE
async function sendFile(e){
  const file = e.target.files[0];
  if(!file) return;

  const base64 = await fileToDataURL(file);
  const type = file.type.startsWith("image") ? "image" : "audio";

  socket.emit("file", {
    type,
    data: base64,
    name:"You"
  });

  if(type === "image"){
    appendMessage("me","You",`<br><img src="${base64}" style="max-width:200px;border-radius:8px">`);
  } else {
    appendMessage("me","You",`<br><audio controls src="${base64}"></audio>`);
  }
}

// SOCKET EVENTS
socket.on("paired", async (data)=>{
  partnerId = data.partner;
  logStatus("Connected to partner");
  nextBtn.disabled = false;
  disconnectBtn.disabled = false;
  muteBtn.disabled = false;
  videoBtn.disabled = false;

  await startLocalStream();
  createPeerConnection();

  const makeOffer = socket.id < partnerId;
  if(makeOffer){
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal",{ to:partnerId, type:"offer", payload:offer });
  }
});

socket.on("signal", async (msg)=>{
  if(msg.type==="offer"){
    partnerId = msg.from;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal",{ to:msg.from,type:"answer",payload:answer });
  }
  else if(msg.type==="answer"){
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
  }
  else if(msg.type==="ice"){
    try{ await pc.addIceCandidate(new RTCIceCandidate(msg.payload)); }catch(e){}
  }
});

// CHAT IN
socket.on("chat",(m)=>{
  if(!m || !m.text) return;
  appendMessage("other","Stranger",m.text);
});

// FILE IN
socket.on("file",(m)=>{
  if(!m) return;
  if(m.type==="image"){
    appendMessage("other","Stranger",`<br><img src="${m.data}" style="max-width:200px;border-radius:8px">`);
  } else {
    appendMessage("other","Stranger",`<br><audio controls src="${m.data}"></audio>`);
  }
});

// DISCONNECTED
socket.on("peer-disconnected", (d)=>{
  if(partnerId && d.id===partnerId){
    hangup();
    resetUI();
    logStatus("Partner Left");
  }
});

// COINS UPDATE
socket.on("coins", c=>{
  if(coinValueEl) coinValueEl.textContent = c || 0;
});

// PRIVATE INVITE
socket.on("private-invite",(p)=>{
  if(confirm("Private Room Invite Received. Join?")){
    socket.emit("private-accept",{ to:p.from, roomId:p.roomId });
  } else {
    socket.emit("private-decline",{ to:p.from });
  }
});

// UI INIT
resetUI();
logStatus("Idle");

// OPTIONAL FIREBASE INITIALIZE
if(window.FIREBASE_CONFIG && typeof firebase!=="undefined"){
  try{
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }catch(e){}
}
