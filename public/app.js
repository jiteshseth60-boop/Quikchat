/* app.js — Final SafeRandom client (Firebase Realtime DB signalling)
   Replace the firebaseConfig values below.
   This is the improved, production-ready single-file client.
*/

/* ======== FIREBASE CONFIG (REPLACE WITH YOUR VALUES) ======== */
const firebaseConfig = {
  apiKey: "PUT_API_KEY",
  authDomain: "PUT_AUTH_DOMAIN",
  databaseURL: "https://PUT_PROJECT-id-default-rtdb.firebaseio.com",
  projectId: "PUT_PROJECT_ID",
  storageBucket: "PUT_BUCKET.appspot.com",
  messagingSenderId: "PUT_MSG_ID",
  appId: "PUT_APP_ID"
};
/* ============================================================ */

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* UI elements (must match index.html) */
const statusTop = document.getElementById('statusTop');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const endBtn = document.getElementById('endBtn');
const reportBtn = document.getElementById('reportBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const switchCamBtn = document.getElementById('switchCamBtn');
const timerEl = document.getElementById('timer');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

const stickerUpload = document.getElementById('stickerUpload');
const localSticker = document.getElementById('localSticker');
const remoteSticker = document.getElementById('remoteSticker');
const maskRange = document.getElementById('maskRange');

const nameInput = document.getElementById('nameInput');
const randNameBtn = document.getElementById('randName');

const genderFilter = document.getElementById('genderFilter');
const countryFilter = document.getElementById('countryFilter'); // new country select
const countVal = document.getElementById('countVal');

/* sounds (tiny silent wav to avoid blocking) */
const connectSound = document.getElementById('connectSound');
const disconnectSound = document.getElementById('disconnectSound');
const foundSound = document.getElementById('foundSound');
connectSound.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
disconnectSound.src = connectSound.src;
foundSound.src = connectSound.src;

/* state */
const clientId = 'c_' + Math.random().toString(36).slice(2,9);
let roomId = null;
let pc = null;
let localStream = null;
let callStart = null;
let callTimer = null;
let isMuted = false;
let videoOff = false;
let currentCam = 'user';

/* keep reference to the rooms listener so we can .off it later */
let roomsChildAddedListener = null;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add TURN here if you have one: { urls: "turn:TURN_HOST:3478", username: "...", credential: "..." }
  ]
};

/* small profanity filter */
const profanity = ['sex','nude','fuck','bitch','ass'];

/* helpers */
function setStatus(s){ statusTop.textContent = s; }
function appendChat(txt){ const d = document.createElement('div'); d.innerText = txt; d.style.margin='6px 0'; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight; }
function randomName(){
  const A=["Sunny","Quick","Brave","Silent","Wild","Blue","Lucky","Happy","Sly","Gentle"];
  const B=["Tiger","Fox","Swan","Panda","Wolf","Eagle","Dolphin","Raven","Hawk","Otter"];
  return A[Math.floor(Math.random()*A.length)] + " " + B[Math.floor(Math.random()*B.length)];
}

/* update simple users online (reads waiting + rooms count) */
async function refreshUserCount(){
  try{
    const snap = await db.ref('waiting').once('value');
    const waiting = snap.val() || {};
    const roomsSnap = await db.ref('rooms').once('value');
    const rooms = roomsSnap.val() || {};
    const count = Object.keys(waiting).length + Object.keys(rooms).length;
    countVal.innerText = count;
  }catch(e){ /* ignore */ }
}

/* firebase helpers */
async function addToWaiting(info){
  await db.ref(`waiting/${clientId}`).set({ ts: Date.now(), info: info || {} });
  // safety TTL — remove waiting entry after 45s automatically
  setTimeout(()=>db.ref(`waiting/${clientId}`).remove().catch(()=>{}), 45000);
}
async function removeFromWaiting(){ await db.ref(`waiting/${clientId}`).remove().catch(()=>{}); }

async function createRoomWith(otherId){
  roomId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
  // meta includes caller and callee so callee sees the room when searching rooms by meta/callee == their id
  await db.ref(`rooms/${roomId}/meta`).set({ caller: clientId, callee: otherId, startedAt: Date.now() });
  return roomId;
}

/* start local media */
async function startLocalStream(){
  if (localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    localVideo.srcObject = localStream;
    localStream.getAudioTracks().forEach(t=>t.enabled = !isMuted);
    localStream.getVideoTracks().forEach(t=>t.enabled = !videoOff);
    return localStream;
  }catch(e){
    alert('Camera/Mic access required — allow and retry');
    throw e;
  }
}

/* remove listeners safe */
function removeRoomListeners(rid){
  try {
    if (!rid) return;
    db.ref(`rooms/${rid}/chat`).off();
    db.ref(`rooms/${rid}/answer`).off();
    db.ref(`rooms/${rid}/candidates`).off();
    db.ref(`rooms/${rid}/sticker`).off();
    db.ref(`rooms/${rid}`).off();
    db.ref(`rooms/${rid}/meta`).off();
  }catch(e){}
}

/* create peer and hooks */
async function createPeer(isCaller){
  pc = new RTCPeerConnection(ICE_CONFIG);

  if (!localStream) await startLocalStream();
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && roomId) {
      db.ref(`rooms/${roomId}/candidates/${clientId}`).push(ev.candidate.toJSON()).catch(()=>{});
    }
  };

  // answer listener (keeps listening until room removed)
  db.ref(`rooms/${roomId}/answer`).on('value', async snap => {
    const val = snap.val();
    if (val && pc) {
      // protect against re-applying same description
      try {
        const remoteDesc = pc.currentRemoteDescription;
        if (!remoteDesc || remoteDesc.sdp !== val.sdp) {
          await pc.setRemoteDescription({ type: val.type, sdp: val.sdp });
        }
      } catch(e){ console.warn('setRemoteDescription(answer) failed', e); }
    }
  });

  // candidates: ignore our own node
  db.ref(`rooms/${roomId}/candidates`).on('child_added', snap => {
    const sender = snap.key;
    if (!snap.exists()) return;
    if (sender === clientId) return;
    const obj = snap.val();
    for (const pushId in obj) {
      const cand = obj[pushId];
      try { if (pc) pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){}
    }
  });

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.ref(`rooms/${roomId}/offer`).set({ from: clientId, sdp: offer.sdp, type: offer.type });
  }
}

/* listen to room events (chat/report/removed) */
function listenRoomEvents(){
  if (!roomId) return;
  db.ref(`rooms/${roomId}/chat`).on('child_added', snap => {
    const m = snap.val();
    appendChat((m.from===clientId? 'You: ' : 'Stranger: ') + m.text);
  });

  db.ref(`rooms/${roomId}/reports`).on('child_added', snap => {
    appendChat('— This room was reported —');
  });

  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val();
    if (!v) return;
    if (v.from !== clientId) { remoteSticker.src = v.url; remoteSticker.hidden=false; }
  });

  // if whole room node removed -> end locally
  db.ref(`rooms/${roomId}`).on('child_removed', snap => {
    appendChat('Room ended by host.');
    endCall(false);
  });
}

/* matching logic */
async function findPartner(){
  setStatus('Finding partner...');
  findBtn.disabled = true;
  nextBtn.disabled = true;
  endBtn.disabled = false;
  await startLocalStream();
  await refreshUserCount();

  // read limited waiting list (limit to 50 for safety)
  const waitingSnap = await db.ref('waiting').limitToFirst(50).once('value');
  const waiting = waitingSnap.val() || {};

  // pick partner using filters: gender + country
  const myGender = (genderFilter && genderFilter.value) ? genderFilter.value : 'any';
  const myCountry = (countryFilter && countryFilter.value) ? countryFilter.value : 'any';

  let otherId = null;
  for (const id of Object.keys(waiting)) {
    if (id === clientId) continue;
    const info = (waiting[id].info) ? waiting[id].info : {};
    const theirGender = info.gender || 'any';
    const theirCountry = info.country || 'any';

    const genderOK = (myGender === 'any' || theirGender === 'any' || myGender === theirGender);
    const countryOK = (myCountry === 'any' || theirCountry === 'any' || myCountry === theirCountry);

    if (genderOK && countryOK) { otherId = id; break; }
  }

  if (otherId) {
    // immediate pair: remove other waiting entry and create room
    try {
      await db.ref(`waiting/${otherId}`).remove().catch(()=>{});
      roomId = await createRoomWith(otherId);
      await createPeer(true);
      listenRoomEvents();
      startTimer();
      setStatus('Calling...');
      foundSound.play().catch(()=>{});
    } catch(e){
      console.warn('immediate pair error', e);
      // fallback to enqueue
      await enqueueSelf({ name: nameInput.value || randomName(), gender: myGender, country: myCountry });
    }
  } else {
    // enqueue self and listen for a room where meta.callee == clientId
    await enqueueSelf({ name: nameInput.value || randomName(), gender: myGender, country: myCountry });
  }
}

/* helper to enqueue self and start room listener */
async function enqueueSelf(info){
  await addToWaiting(info);
  setStatus('Waiting for partner...');
  // remove any previous rooms listener to avoid duplicates
  if (roomsChildAddedListener) {
    db.ref('rooms').off('child_added', roomsChildAddedListener);
    roomsChildAddedListener = null;
  }
  // set listener to detect rooms created where meta.callee == clientId
  const onRoomAdded = async (snap) => {
    try {
      if (!snap.exists()) return;
      // If we already have a room (maybe matched elsewhere), ignore
      if (roomId) return;
      const meta = (snap.child('meta').exists()) ? snap.child('meta').val() : null;
      if (meta && meta.callee === clientId) {
        // we are the callee — join flow
        roomId = snap.key;
        // stop listening for future rooms (we matched)
        if (roomsChildAddedListener) {
          db.ref('rooms').off('child_added', roomsChildAddedListener);
          roomsChildAddedListener = null;
        }
        await startLocalStream();
        await onMatchedAsCallee();
      }
    } catch(e){ console.warn('onRoomAdded error', e); }
  };
  roomsChildAddedListener = onRoomAdded;
  db.ref('rooms').on('child_added', roomsChildAddedListener);
}

/* callee flow */
async function onMatchedAsCallee(){
  try{
    const offerSnap = await db.ref(`rooms/${roomId}/offer`).once('value');
    const offer = offerSnap.val();
    if (!offer) return;
    await createPeer(false);
    try { await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp }); } catch(e){ console.warn('setRemoteDescription(offer) failed', e); }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await db.ref(`rooms/${roomId}/answer`).set({ from: clientId, sdp: answer.sdp, type: answer.type });
    listenRoomEvents();
    startTimer();
    setStatus('Connected');
    foundSound.play().catch(()=>{});
  }catch(e){ console.warn('callee flow error', e); }
}

/* chat handling */
sendBtn.onclick = async () => {
  const text = (chatInput.value || '').trim();
  if (!text || !roomId) return;
  const low = text.toLowerCase();
  for (const p of profanity) if (low.includes(p)) {
    await reportUser('profanity');
    appendChat('You: ' + text);
    chatInput.value = '';
    return;
  }
  await db.ref(`rooms/${roomId}/chat`).push({ from: clientId, text, ts: Date.now() });
  chatInput.value = '';
};

/* reporting */
reportBtn.onclick = async () => {
  if (!roomId) return alert('No active room to report.');
  const reason = prompt('Report reason (optional):');
  await reportUser(reason || 'reported');
  alert('Reported. Moderation will review.');
  await endCall(false);
};

async function reportUser(reason){
  try { await db.ref(`rooms/${roomId}/reports`).push({ from: clientId, reason, ts: Date.now() }); }
  catch(e){ console.warn('report failed', e); }
}

/* timer */
function startTimer(){ callStart = Date.now(); timerEl.textContent='00:00'; callTimer = setInterval(()=>{ const s = Math.floor((Date.now()-callStart)/1000); timerEl.textContent = formatTime(s); },1000); }
function stopTimer(){ if(callTimer) clearInterval(callTimer); callTimer=null; timerEl.textContent='00:00'; }
function formatTime(s){ const m = String(Math.floor(s/60)).padStart(2,'0'); const ss = String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

/* controls */
muteBtn.onclick = () => { isMuted = !isMuted; if (localStream) localStream.getAudioTracks().forEach(t=>t.enabled = !isMuted); muteBtn.textContent = isMuted ? 'Unmute' : 'Mute'; };
videoBtn.onclick = () => { videoOff = !videoOff; if (localStream) localStream.getVideoTracks().forEach(t=>t.enabled = !videoOff); videoBtn.textContent = videoOff ? 'Video On' : 'Video Off'; };

switchCamBtn.onclick = async () => {
  currentCam = currentCam === 'user' ? 'environment' : 'user';
  if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  await startLocalStream();
  if (pc && localStream) {
    const senders = pc.getSenders().filter(s=>s.track && s.track.kind==='video');
    const newTrack = localStream.getVideoTracks()[0];
    if (senders.length && newTrack) senders[0].replaceTrack(newTrack);
    else localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  }
};

/* next/end */
nextBtn.onclick = async () => { await endCall(true); findBtn.disabled=false; setTimeout(()=>findBtn.click(), 350); };
endBtn.onclick = async () => await endCall(false);

/* sticker upload */
stickerUpload.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    localSticker.src = r.result; localSticker.hidden=false;
    if (roomId) await db.ref(`rooms/${roomId}/sticker`).set({ from: clientId, url: r.result, ts: Date.now() });
  };
  r.readAsDataURL(f);
});

/* listen for sticker changes (if joined) */
function listenSticker(){
  if (!roomId) return;
  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val(); if (!v) return;
    if (v.from !== clientId) { remoteSticker.src = v.url; remoteSticker.hidden=false; }
  });
}

/* end/cleanup */
async function endCall(rematch=false){
  try {
    // remove room listeners first
    if (roomId) {
      removeRoomListeners(roomId);
      // remove room node so other peer sees end (optional)
      await db.ref(`rooms/${roomId}`).remove().catch(()=>{});
      roomId = null;
    }
  } catch(e){ console.warn('endCall cleanup err', e); }

  if (pc) { try { pc.close(); } catch(e) {} pc = null; }
  remoteVideo.srcObject = null;
  stopTimer();
  findBtn.disabled=false; nextBtn.disabled=true; endBtn.disabled=true;
  setStatus('Disconnected');
  // ensure we are not in waiting list
  await removeFromWaiting();

  // remove rooms listener if present (we are no longer interested)
  if (roomsChildAddedListener) {
    db.ref('rooms').off('child_added', roomsChildAddedListener);
    roomsChildAddedListener = null;
  }
}

/* cleanup on unload */
window.addEventListener('beforeunload', () => {
  db.ref(`waiting/${clientId}`).remove().catch(()=>{});
  if (roomId) db.ref(`rooms/${roomId}`).remove().catch(()=>{});
});

/* boot handlers */
findBtn.onclick = async () => {
  findBtn.disabled=true; nextBtn.disabled=true; endBtn.disabled=false;
  // set chosen name + filters into waiting info
  await findPartner();
};
randNameBtn.addEventListener('click', ()=>{ nameInput.value = randomName(); });

/* small periodic refresh */
setInterval(()=>refreshUserCount(), 8000);

/* initial UI setup */
nameInput.value = randomName();
document.getElementById('localName').innerText = `(${nameInput.value})`;
setStatus('Ready — click Find to start');

/* Debug helper - expose some internals (optional) */
window.__quikchat = {
  clientId,
  getRoomId: () => roomId,
  getLocalStream: () => localStream,
  getPeer: () => pc
};
