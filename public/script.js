const socket = io();
let localStream, pc, partnerId, timerInterval, sec = 0;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const statusSpan = document.getElementById('status');
const timer = document.getElementById('timer');

// CHAT UI refs
const chatBox = document.getElementById("chatBox");
const messages = document.getElementById("messages");
const msgInput = document.getElementById("msgInput");
const sendMsg = document.getElementById("sendMsg");
const imgBtn = document.getElementById("imgBtn");
const imgInput = document.getElementById("imgInput");
const audioBtn = document.getElementById("audioBtn");
const audioInput = document.getElementById("audioInput");

// ---- Camera ----
async function startCam(){
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
  localVideo.srcObject = localStream;
}

// ---- Timer ----
function startTimer(){
  clearInterval(timerInterval);
  sec = 0;
  timerInterval = setInterval(()=>{
    sec++;
    let m = String(Math.floor(sec/60)).padStart(2,'0');
    let s = String(sec%60).padStart(2,'0');
    timer.textContent = `${m}:${s}`;
  },1000);
}

// ---- RTC ----
function createPC(){
  pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];
  pc.onicecandidate = e => e.candidate && socket.emit("signal",{to:partnerId,type:"ice",payload:e.candidate});
  return pc;
}

// ---- UI Reset ----
function reset(){
  partnerId = null;
  remoteVideo.srcObject = null;
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  statusSpan.textContent = "Idle";
  clearInterval(timerInterval);
  timer.textContent = "00:00";
}

// ---- Peer disconnect ----
socket.on("peer-disconnected", data=>{
  if(data.id===partnerId){
    reset(); messages.innerHTML="";
  }
});

// ---- Pair event ----
socket.on("paired", async data=>{
  partnerId = data.partner;
  statusSpan.textContent = "Paired " + partnerId;
  nextBtn.disabled = false;
  disconnectBtn.disabled = false;
  muteBtn.disabled = false;
  videoBtn.disabled = false;
  messages.innerHTML="";
  startTimer();

  await startCam();
  createPC();
  if (socket.id < partnerId){
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal",{to:partnerId,type:"offer",payload:offer});
  }
});

// ---- Signalling ----
socket.on("signal", async msg=>{
  if (!pc) createPC();
  if(msg.type==="offer"){
    partnerId = msg.from;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit("signal",{to:msg.from,type:"answer",payload:ans});
  } else if(msg.type==="answer"){
    await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
  } else if(msg.type==="ice"){
    await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
  }
});

// ---- Controls ----
findBtn.onclick = async () => { await startCam(); socket.emit("joinQueue"); statusSpan.textContent="Searching..."; findBtn.disabled=true; };
nextBtn.onclick = () => { socket.emit("next"); reset(); statusSpan.textContent="Searching next..."; };
disconnectBtn.onclick = () => { socket.emit("leaveQueue"); reset(); };

// ---- Chat send ----
sendMsg.onclick = ()=>{
  if(!msgInput.value.trim()) return;
  socket.emit("send-message",{to:partnerId,msg:msgInput.value});
  addMessage(msgInput.value,true);
  msgInput.value="";
};

socket.on("receive-message",data=>{
  addMessage(data.msg,false);
});

function addMessage(t,me){
  const d=document.createElement("div");
  d.className="msg"+(me?" me":"");
  d.textContent=t;
  messages.appendChild(d);
  messages.scrollTop=messages.scrollHeight;
}

// ---- Image send ----
imgBtn.onclick=()=> imgInput.click();
imgInput.onchange=()=>{
  const file = imgInput.files[0];
  const reader=new FileReader();
  reader.onload=()=> socket.emit("send-image",{to:partnerId,image:reader.result});
  reader.readAsDataURL(file);
};

socket.on("receive-image",data=>{
  let d=document.createElement("div");
  d.className="msg";
  d.innerHTML=`<img src="${data.image}" style="max-width:160px;border-radius:6px"/>`;
  messages.appendChild(d);
  messages.scrollTop=messages.scrollHeight;
});

// ---- Audio ----
audioBtn.onclick=()=> audioInput.click();
audioInput.onchange=()=>{
  const f = audioInput.files[0];
  const r=new FileReader();
  r.onload=()=> socket.emit("send-audio",{to:partnerId,audio:r.result});
  r.readAsDataURL(f);
};

socket.on("receive-audio",data=>{
  let d=document.createElement("div");
  d.className="msg";
  d.innerHTML=`<audio controls src="${data.audio}"></audio>`;
  messages.appendChild(d);
});
