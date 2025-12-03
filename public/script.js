// script.js
/* Globals */
const socket = io();
let localStream = null;
let pc = null;
let partnerId = null;
let inPrivate = false;
let privateRoomId = null;
let privateInterval = null;
const PRICE_PER_MIN = 10; // 10 coins = 1 minute

// ICE servers - add OpenRelay or Xirsys credentials if you have
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  // Example OpenRelay (works for small launch). Replace if you have credentials.
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" }
];

/* UI refs */
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const messages = document.getElementById('chatBox');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const coinCountEl = document.getElementById('coinCount');
const imgInput = document.getElementById('imgInput');
const audioInput = document.getElementById('audioInput');
const privateBtn = document.getElementById('privateBtn');

let user = { uid: null, coins: 0 };

/* Firebase / Auth */
(async function initAuth(){
  try {
    const res = await firebase.auth().signInAnonymously();
    user.uid = res.user.uid;
    // create user doc if not exists
    const userDoc = db.collection('users').doc(user.uid);
    const snap = await userDoc.get();
    if (!snap.exists) {
      await userDoc.set({ coins: 50, createdAt: Date.now() }); // seed 50 coins for testing
    }
    const updated = await userDoc.get();
    user.coins = updated.data().coins || 0;
    coinCountEl.textContent = user.coins;
    // listen to coin changes live
    userDoc.onSnapshot(doc => {
      const d = doc.data();
      if (d && typeof d.coins === 'number') {
        user.coins = d.coins;
        coinCountEl.textContent = user.coins;
      }
    });
  } catch (e) {
    console.error('Firebase auth failed', e);
    alert('Firebase auth error. Check config.');
  }
})();

/* Helpers */
function addBubble(text, who = 'other', extraHtml = '') {
  const div = document.createElement('div');
  div.className = 'bubble ' + (who === 'me' ? 'me' : 'other');
  div.innerHTML = `<div>${text}</div>${extraHtml}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

/* Chat events */
sendBtn.onclick = () => {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat', t);
  addBubble(t, 'me');
  msgInput.value = '';
};

/* File uploads (images/audio) */
imgInput.onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const ref = storage.ref().child(`uploads/images/${user.uid}_${Date.now()}_${f.name}`);
  const up = await ref.put(f);
  const url = await ref.getDownloadURL();
  // send chat message with image url
  socket.emit('chat', JSON.stringify({ type: 'image', url, name: f.name }));
  addBubble('Image sent', 'me', `<div><a href="${url}" target="_blank"><img src="${url}" style="max-width:200px;border-radius:8px"></a><br><a href="${url}" download>Download</a></div>`);
};

audioInput.onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const ref = storage.ref().child(`uploads/audio/${user.uid}_${Date.now()}_${f.name}`);
  const up = await ref.put(f);
  const url = await ref.getDownloadURL();
  socket.emit('chat', JSON.stringify({ type: 'audio', url, name: f.name }));
  addBubble('Audio sent', 'me', `<div><audio controls src="${url}"></audio><br><a href="${url}" download>Download</a></div>`);
};

/* Socket handlers: chat messages and matchmaking */
socket.on('waiting', () => addBubble('Searching for partner...', 'other'));
socket.on('matched', async (data) => {
  partnerId = data.partner;
  addBubble('Partner found: ' + partnerId, 'other');
  nextBtn.disabled = false;
  findBtn.disabled = true;
  await startLocalStream();
  await startPeerAsOffer();
});

socket.on('chat', (msgData) => {
  // if JSON image/audio
  try {
    const parsed = JSON.parse(msgData);
    if (parsed.type === 'image') {
      addBubble('Partner sent image', 'other', `<div><a href="${parsed.url}" target="_blank"><img src="${parsed.url}" style="max-width:200px;border-radius:8px"></a><br><a href="${parsed.url}" download>Download</a></div>`);
      return;
    } else if (parsed.type === 'audio') {
      addBubble('Partner sent audio', 'other', `<div><audio controls src="${parsed.url}"></audio><br><a href="${parsed.url}" download>Download</a></div>`);
      return;
    }
  } catch (e) {
    // not JSON -> plain text
  }
  addBubble(msgData, 'other');
});

socket.on('partner-left', () => {
  addBubble('Partner left', 'other');
  cleanupPeer();
  findBtn.disabled = false;
  nextBtn.disabled = true;
});

socket.on('signal', async (data) => {
  const payload = data.payload;
  if (!pc) await startLocalStream().then(() => createPeerConnection());
  if (payload.offer) {
    await pc.setRemoteDescription(payload.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: data.from, payload: { answer } });
  } else if (payload.answer) {
    await pc.setRemoteDescription(payload.answer);
  } else if (payload.candidate) {
    try { await pc.addIceCandidate(payload.candidate); } catch (e) {}
  }
});

/* Private Room flow */
privateBtn.onclick = () => {
  // send private request to partner
  if (!partnerId) { alert('No partner to request private with'); return; }
  const price = PRICE_PER_MIN;
  socket.emit('private-request', { pricePerMinute: price });
  addBubble('Private room request sent', 'me');
};

socket.on('private-request', (data) => {
  // show accept/decline
  const from = data.from;
  const price = data.pricePerMinute || PRICE_PER_MIN;
  if (!confirm(`User wants a Private Room. Price: ${price} coins / min. Accept?`)) {
    socket.emit('private-decline', { to: from });
    return;
  }
  // Accept → send private-accept
  const roomId = `${from}_${socket.id}_${Date.now()}`;
  socket.emit('private-accept', { with: from, roomId });
});

socket.on('private-start', (info) => {
  inPrivate = true;
  privateRoomId = info.roomId;
  addBubble('Private Room started', 'other');
  // start local timer to deduct coins: every 60s reduce coins by PRICE_PER_MIN
  startPrivateCoinCountdown();
});

socket.on('private-ended', () => {
  addBubble('Private Room ended', 'other');
  stopPrivateCoinCountdown();
});

/* PeerConnection helpers */
async function startLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    return localStream;
  } catch(e) {
    alert('Camera/Mic required. Allow permissions.');
    throw e;
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; };
  pc.onicecandidate = (e) => {
    if (e.candidate && partnerId) socket.emit('signal', { to: partnerId, payload: { candidate: e.candidate } });
  };
  return pc;
}

async function startPeerAsOffer() {
  createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to: partnerId, payload: { offer } });
}

function cleanupPeer() {
  if (pc) try { pc.close(); } catch(e) {}
  pc = null;
  partnerId = null;
  remoteVideo.srcObject = null;
}

/* Next button */
nextBtn.onclick = () => {
  socket.emit('leave');
  cleanupPeer();
  findBtn.disabled = false;
  nextBtn.disabled = true;
  addBubble('Searching next...', 'me');
  socket.emit('find');
};

/* Private coin countdown (client side) - NOTE: for production, do server-side transactions */
function startPrivateCoinCountdown() {
  // every minute deduct PRICE_PER_MIN coins from user's doc
  if (privateInterval) clearInterval(privateInterval);
  privateInterval = setInterval(async () => {
    const userRef = db.collection('users').doc(user.uid);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      if (!doc.exists) throw new Error('User doc missing');
      let coins = doc.data().coins || 0;
      coins = coins - PRICE_PER_MIN;
      if (coins < 0) {
        // stop private, notify partner
        socket.emit('private-end', privateRoomId);
        stopPrivateCoinCountdown();
        alert('Coins finished. Watch an ad to continue or buy coins.');
        return;
      }
      tx.update(userRef, { coins });
    });
  }, 60000); // every minute
}

function stopPrivateCoinCountdown() {
  if (privateInterval) clearInterval(privateInterval);
  privateInterval = null;
  inPrivate = false;
  privateRoomId = null;
}

/* Simulated Rewarded Ad: In production integrate AdMob rewarded ads or other provider */
async function showRewardedAdAndGrant() {
  // Simulate ad watch time
  addBubble('Watching ad... +10 coins after 5s', 'other');
  await new Promise(r => setTimeout(r, 5000));
  // grant 10 coins
  const userRef = db.collection('users').doc(user.uid);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const coins = (doc.data().coins || 0) + 10;
    tx.update(userRef, { coins });
  });
  addBubble('You received +10 coins', 'me');
}

/* UI: double-click chat bubble for download if link exists (handled in addBubble via anchor tags) */
/* Expose ad watcher on coin button (for quick testing) */
coinCountEl.addEventListener('click', () => {
  if (confirm('Watch an ad for +10 coins? (simulated)')) showRewardedAdAndGrant();
});

/* Start/Stop initial find on page */
findBtn.onclick = () => {
  findBtn.disabled = true;
  socket.emit('find');
};
