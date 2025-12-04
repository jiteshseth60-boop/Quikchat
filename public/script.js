// public/script.js — FINAL QuikChat (Glass UI)
const socket = io();
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

const MAX_FILE_BYTES = 4_700_000; // ~4.7MB

function logStatus(t){ if(statusEl) statusEl.textContent = t; console.log('[status]', t); }

// --- media
async function startLocalStream(){
  if(localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480}, audio:true});
    if(localVideo) localVideo.srcObject = localStream;
    return localStream;
  }catch(e){
    alert('Camera/Mic permission needed. Use HTTPS and allow permissions.');
    throw e;
  }
}

function createPeerConnection(){
  if(pc) return pc;
  const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  pc = new RTCPeerConnection(config);

  if(localStream){ localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); }

  pc.ontrack = (ev) => { try{ remoteVideo.srcObject = ev.streams[0]; }catch(e){console.warn(e);} }

  pc.onicecandidate = (e) => { if(e.candidate && partnerId){ socket.emit('signal',{ to: partnerId, type: 'ice', payload: e.candidate }); } }

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState || pc.iceConnectionState;
    logStatus('PC: ' + s);
    if(s === 'disconnected' || s === 'failed' || s === 'closed'){
      resetUIAfterHangup();
    }
  }

  return pc;
}

function hangupCleanup(){
  try{ if(pc){ pc.close(); pc = null; } }catch(e){}
  try{ if(remoteVideo) remoteVideo.srcObject = null; }catch(e){}
  partnerId = null;
  clearInterval(callTimer); seconds = 0; timerEl.textContent = '00:00';
}

function resetUIAfterHangup(){
  hangupCleanup();
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  muteBtn.disabled = true;
  videoBtn.disabled = true;
  pairIdEl.textContent = '';
  logStatus('Idle');
}

function startCallTimer(){
  clearInterval(callTimer); seconds = 0; timerEl.textContent = '00:00';
  callTimer = setInterval(()=>{
    seconds++;
    const m = String(Math.floor(seconds/60)).padStart(2,'0');
    const s = String(seconds%60).padStart(2,'0');
    timerEl.textContent = `${m}:${s}`;
  },1000);
}

// --- UI events
startBtn.onclick = async ()=>{
  const name = nameInput.value.trim() || 'Anonymous';
  startOverlay.style.display = 'none';
  await startLocalStream();
  logStatus('Ready - Click Find');
}

findBtn.onclick = async ()=>{
  try{
    findBtn.disabled = true;
    const prefs = { gender: genderInput.value || '', country: countryInput.value || '' };
    await startLocalStream();
    socket.emit('joinQueue', prefs);
    logStatus('Searching...');
  }catch(e){ findBtn.disabled = false; }
}

nextBtn.onclick = ()=>{
  socket.emit('next');
  hangupCleanup();
  findBtn.disabled = true; nextBtn.disabled = true; disconnectBtn.disabled = true; logStatus('Searching next...');
}

disconnectBtn.onclick = ()=>{ socket.emit('leaveQueue'); resetUIAfterHangup(); }

muteBtn.onclick = ()=>{ if(!localStream) return; const audioTracks = localStream.getAudioTracks(); if(!audioTracks.length) return; audioTracks.forEach(t=>t.enabled = !t.enabled); muteBtn.textContent = audioTracks[0].enabled ? 'Mute' : 'Unmute'; }

videoBtn.onclick = ()=>{ if(!localStream) return; const vTracks = localStream.getVideoTracks(); if(!vTracks.length) return; vTracks.forEach(t=>t.enabled = !t.enabled); videoBtn.textContent = vTracks[0].enabled ? 'Video Off' : 'Video On'; }

// chat send
sendBtn.onclick = ()=>{ const txt = (messageInput.value||'').trim(); if(!txt || !partnerId) return; socket.emit('signal',{ to: partnerId, type: 'msg', payload: { text: txt, name: nameInput.value || 'You' } }); appendMessage({ fromName:'You', text:txt, me:true }); messageInput.value=''; }

function appendMessage({ fromName='Stranger', text='', me=false, type='text', dataUrl=null }){
  if(!messagesEl) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'bubble '+(me ? 'me' : 'other');
  const title = document.createElement('div'); title.className='bubble-title'; title.textContent = fromName; wrapper.appendChild(title);
  if(type==='text'){ const p=document.createElement('div'); p.textContent=text; wrapper.appendChild(p); }
  else if(type==='image'){ const img=document.createElement('img'); img.src=dataUrl; img.style.maxWidth='240px'; wrapper.appendChild(img); }
  else if(type==='audio'){ const a=document.createElement('audio'); a.controls=true; a.src=dataUrl; wrapper.appendChild(a); }
  messagesEl.appendChild(wrapper); messagesEl.scrollTop = messagesEl.scrollHeight;
}

// file helpers
function fileToDataURL(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); }); }

imageInput.onchange = async (e)=>{
  const f = e.target.files && e.target.files[0]; if(!f || !partnerId) { e.target.value=''; return; }
  if(f.size > MAX_FILE_BYTES){ alert('Image too large (~4.7MB max)'); e.target.value=''; return; }
  const data = await fileToDataURL(f);
  socket.emit('signal', { to: partnerId, type: 'file', payload: { fileType:'image', name:f.name, data } });
  appendMessage({ fromName:'You', type:'image', dataUrl:data, me:true });
  e.target.value='';
}

musicInput.onchange = async (e)=>{
  const f = e.target.files && e.target.files[0]; if(!f || !partnerId) { e.target.value=''; return; }
  if(f.size > MAX_FILE_BYTES){ alert('Audio too large (~4.7MB max)'); e.target.value=''; return; }
  const data = await fileToDataURL(f);
  socket.emit('signal', { to: partnerId, type: 'file', payload: { fileType:'audio', name:f.name, data } });
  appendMessage({ fromName:'You', type:'audio', dataUrl:data, me:true });
  e.target.value='';
}

// --- socket handlers
socket.on('paired', async (data)=>{
  partnerId = data.partner;
  pairIdEl.textContent = 'Paired ' + partnerId;
  logStatus('Paired: ' + partnerId);
  nextBtn.disabled = false; disconnectBtn.disabled = false; muteBtn.disabled = false; videoBtn.disabled = false;
  messagesEl.innerHTML = '';
  startCallTimer();
  await startLocalStream();
  createPeerConnection();
  const makeOffer = socket.id < partnerId;
  if(makeOffer){ try{ const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('signal',{ to: partnerId, type:'offer', payload:offer }); logStatus('Offer sent'); }catch(e){console.error(e);} }
});

socket.on('signal', async (msg)=>{
  if(!msg || !msg.type) return;
  const from = msg.from;
  if(!pc && (msg.type==='offer' || msg.type==='ice' || msg.type==='answer')){ await startLocalStream(); createPeerConnection(); }

  if(msg.type==='offer'){
    partnerId = from; logStatus('Offer received');
    try{ await pc.setRemoteDescription(new RTCSessionDescription(msg.payload)); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('signal', { to: from, type:'answer', payload: answer }); logStatus('Answer sent'); }catch(e){console.error(e);}
  }
  else if(msg.type==='answer'){ try{ await pc.setRemoteDescription(new RTCSessionDescription(msg.payload)); }catch(e){console.error(e);} }
  else if(msg.type==='ice'){ try{ await pc.addIceCandidate(new RTCIceCandidate(msg.payload)); }catch(e){console.warn(e);} }
  else if(msg.type==='msg'){ const p = msg.payload||{}; appendMessage({ fromName:p.name||'Partner', text:p.text||'', me:false }); }
  else if(msg.type==='file'){ const p = msg.payload||{}; if(p.fileType==='image' && p.data) appendMessage({ fromName:'Partner', type:'image', dataUrl:p.data, me:false }); else if(p.fileType==='audio' && p.data) appendMessage({ fromName:'Partner', type:'audio', dataUrl:p.data, me:false }); else appendMessage({ fromName:'Partner', text:'[file]', me:false }); }
});

socket.on('peer-disconnected',(d)=>{ if(d && d.id===partnerId){ logStatus('Partner disconnected'); resetUIAfterHangup(); } });

// helper: start peer connection
function createPeerConnection(){
  if(pc) return pc;
  const config = { iceServers:[{ urls:'stun:stun.l.google.com:19302' }] };
  pc = new RTCPeerConnection(config);
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  pc.ontrack = (e)=>{ try{ remoteVideo.srcObject = e.streams[0]; }catch(e){} };
  pc.onicecandidate = (e)=>{ if(e.candidate && partnerId) socket.emit('signal',{ to: partnerId, type:'ice', payload:e.candidate }); };
  pc.onconnectionstatechange = ()=>{ const s = pc.connectionState||pc.iceConnectionState; logStatus('PC:'+s); if(s==='disconnected'||s==='failed'||s==='closed') resetUIAfterHangup(); };
  return pc;
}

function startCallTimer(){ clearInterval(callTimer); seconds=0; timerEl.textContent='00:00'; callTimer=setInterval(()=>{ seconds++; const m=String(Math.floor(seconds/60)).padStart(2,'0'); const s=String(seconds%60).padStart(2,'0'); timerEl.textContent=`${m}:${s}`; },1000); }

// init UI
resetUIAfterHangup(); logStatus('Idle');
