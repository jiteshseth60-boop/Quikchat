/* script.js
   Final client script for QuikChat:
   - WebRTC signaling via Socket.IO
   - Chat bubble UI (text, image, audio)
   - Image/audio upload to Firebase Storage + download links
   - Private room request / accept flow
   - Simple coin deduction using Firestore transactions
   - Simulated rewarded-ad for +10 coins (replace with real Ad SDK later)
   - Uses OpenRelay TURN entry for early launch (replace with paid TURN later)
*/

/* ====== CONFIG ====== */
// ICE / TURN servers - replace TURN creds with your provider when ready
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Free OpenRelay (early stage). Replace when you have proper credentials.
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" }
];

const PRICE_PER_MIN = 10; // coins deducted per 1 minute in private room
const AD_REWARD = 10;     // coins granted per rewarded ad

/* ====== ELEMENTS ====== */
const socket = io();
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messagesEl = document.getElementById("messages");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const musicBtn = document.getElementById("musicBtn");
const musicInput = document.getElementById("musicInput");
const privateBtn = document.getElementById("privateBtn");
const coinValueEl = document.getElementById("coinValue");
const adPopup = document.getElementById("adPopup");
const watchAdBtn = document.getElementById("watchAdBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

/* ====== STATE ====== */
let localStream = null;
let pc = null;
let partnerId = null;
let inPrivate = false;
let privateRoomId = null;
let privateTimerInterval = null;
let user = { uid: null, coins: 0 };

/* ====== FIREBASE: already initialized in index.html (compat mode) ====== */
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

/* ====== AUTH: anonymous sign-in & user doc setup ====== */
(async function initAuth() {
  try {
    const res = await auth.signInAnonymously();
    user.uid = res.user.uid;
    const userRef = db.collection("users").doc(user.uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      // Seed small coins for testing
      await userRef.set({ coins: 50, createdAt: Date.now() });
    }
    // Live listener for coin changes
    userRef.onSnapshot(doc => {
      const d = doc.data() || {};
      user.coins = d.coins ?? 0;
      coinValueEl.textContent = user.coins;
    });
  } catch (err) {
    console.error("Firebase auth failed:", err);
    alert("Firebase auth error. Check console and your firebase config.");
  }
})();

/* ====== UI helpers ====== */
function addBubble(contentHtml, who = "other") {
  const div = document.createElement("div");
  div.className = "bubble " + (who === "me" ? "me" : "other");
  div.innerHTML = contentHtml;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addTextBubble(text, who = "other") {
  addBubble(`<div>${escapeHtml(text)}</div>`, who);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* ====== Chat send/receive ====== */
sendBtn.onclick = () => {
  const txt = messageInput.value.trim();
  if (!txt) return;
  socket.emit("sendMessage", txt);
  addTextBubble(txt, "me");
  messageInput.value = "";
};

socket.on("receiveMessage", (txt) => {
  addTextBubble(txt, "other");
});

/* ====== Image Upload & Send ====== */
imageBtn.onclick = () => imageInput.click();
imageInput.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const path = `uploads/images/${user.uid}_${Date.now()}_${f.name}`;
    const ref = storage.ref(path);
    const up = await ref.put(f);
    const url = await ref.getDownloadURL();
    // tell partner
    socket.emit("sendImage", { url, name: f.name });
    addBubble(`<div>Image sent</div>
      <div><a href="${url}" target="_blank"><img src="${url}" style="max-width:200px;border-radius:8px"></a><br><a href="${url}" download>Download</a></div>`, "me");
  } catch (err) {
    console.error("Image upload failed", err);
    alert("Image upload failed.");
  } finally {
    imageInput.value = "";
  }
};

socket.on("receiveImage", (obj) => {
  if (!obj || !obj.url) return;
  addBubble(`<div>Partner sent image</div>
    <div><a href="${obj.url}" target="_blank"><img src="${obj.url}" style="max-width:200px;border-radius:8px"></a><br><a href="${obj.url}" download>Download</a></div>`, "other");
});

/* ====== Music/Audio Upload & Send ====== */
musicBtn.onclick = () => musicInput.click();
musicInput.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const path = `uploads/audio/${user.uid}_${Date.now()}_${f.name}`;
    const ref = storage.ref(path);
    const up = await ref.put(f);
    const url = await ref.getDownloadURL();
    socket.emit("sendAudio", { url, name: f.name });
    addBubble(`<div>Music sent: ${escapeHtml(f.name)}</div>
      <div><audio controls src="${url}"></audio><br><a href="${url}" download>Download</a></div>`, "me");
  } catch (err) {
    console.error("Audio upload failed", err);
    alert("Audio upload failed.");
  } finally {
    musicInput.value = "";
  }
};

socket.on("receiveAudio", (obj) => {
  if (!obj || !obj.url) return;
  addBubble(`<div>Partner sent audio: ${escapeHtml(obj.name || "audio")}</div>
    <div><audio controls src="${obj.url}"></audio><br><a href="${obj.url}" download>Download</a></div>`, "other");
});

/* ====== Matchmaking ====== */
findBtn.onclick = () => {
  findBtn.disabled = true;
  socket.emit("findPartner");
  addTextBubble("Searching for partner...", "me");
};

nextBtn.onclick = () => {
  // "Next" asks server to just re-find: we do leave and then find
  socket.emit("leave"); // some server variants use this
  cleanupPeer();
  addTextBubble("Looking for next partner...", "me");
  socket.emit("findPartner");
};

/* ====== Signaling & WebRTC ====== */
async function startLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    return localStream;
  } catch (err) {
    console.error("getUserMedia error", err);
    alert("Camera/Mic access required. Allow permissions and refresh.");
    throw err;
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // add local tracks
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && partnerId) {
      socket.emit("ice", { to: partnerId, candidate: ev.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState || pc.iceConnectionState;
    addTextBubble("PC: " + s, "other");
    if (s === "disconnected" || s === "failed" || s === "closed") {
      cleanupPeer();
      findBtn.disabled = false;
    }
  };

  return pc;
}

/* Server tells us partnerFound (server side naming from server.js) */
socket.on("partnerFound", async (id) => {
  partnerId = id;
  addTextBubble("Partner found: " + partnerId, "other");
  nextBtn.disabled = false;
  findBtn.disabled = true;

  await startLocalStream();
  createPeerConnection();

  // decide who creates offer deterministically to avoid collision:
  const makeOffer = socket.id < partnerId;
  if (makeOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { to: partnerId, offer });
  } else {
    addTextBubble("Waiting for offer...", "other");
  }
});

/* Incoming signaling events relayed by server */
socket.on("offer", async (data) => {
  if (!pc) {
    await startLocalStream();
    createPeerConnection();
  }
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: data.from, answer });
});

socket.on("answer", async (data) => {
  if (pc && data.answer) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});

socket.on("ice", async (data) => {
  if (pc && data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
  }
});

/* Cleanup on partner disconnect */
socket.on("partnerDisconnected", () => {
  addTextBubble("Partner disconnected", "other");
  cleanupPeer();
  findBtn.disabled = false;
  nextBtn.disabled = true;
});

/* ====== Private Room Flow ====== */
privateBtn.onclick = () => {
  if (!partnerId) return alert("No partner connected.");
  socket.emit("privateRequest"); // server will forward to partner
  addTextBubble("Private request sent", "me");
};

socket.on("privateRequest", (data) => {
  // show confirm popup: Accept private room?
  // We keep it simple: use window.confirm for mobile compatibility.
  const accept = confirm("Partner requested Private Room (10 coins/min). Accept?");
  if (accept) {
    socket.emit("privateAccept"); // notify requester
  } else {
    // nothing else necessary; server can handle decline if implemented
    addTextBubble("Private declined", "me");
  }
});

socket.on("privateAccept", (data) => {
  // server notifies both with privateAccept - we start private session client-side
  inPrivate = true;
  privateRoomId = `private_${Date.now()}_${socket.id}_${partnerId}`;
  addTextBubble("Private room started", "other");
  // start coin deduction timer (client-side). For production, do server-side.
  startPrivateCoinMeter();
});

/* Private timer logic (client-side) */
function startPrivateCoinMeter() {
  stopPrivateCoinMeter();
  privateTimerInterval = setInterval(async () => {
    try {
      const userRef = db.collection("users").doc(user.uid);
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        if (!doc.exists) throw new Error("User doc missing");
        const coins = (doc.data().coins || 0) - PRICE_PER_MIN;
        if (coins < 0) {
          // stop and notify
          socket.emit("privateEnd", { roomId: privateRoomId });
          stopPrivateCoinMeter();
          alert("Coins finished. Watch an ad to continue or buy coins.");
          showAdPopup();
          return;
        }
        tx.update(userRef, { coins });
      });
    } catch (err) {
      console.error("Coin deduction error", err);
    }
  }, 60 * 1000); // every 60 seconds
}

function stopPrivateCoinMeter() {
  if (privateTimerInterval) clearInterval(privateTimerInterval);
  privateTimerInterval = null;
  inPrivate = false;
  privateRoomId = null;
}

/* server may notify end */
socket.on("privateEnd", () => {
  addTextBubble("Private ended by partner", "other");
  stopPrivateCoinMeter();
});

/* ====== Ad reward popup & simulated ad ====== */
function showAdPopup() {
  adPopup.classList.remove("hidden");
}
watchAdBtn.onclick = async () => {
  adPopup.classList.add("hidden");
  await simulateAdAndGrant();
};

async function simulateAdAndGrant() {
  addTextBubble("Watching ad... (+10 coins)", "other");
  // simulate 5s "ad"
  await new Promise(r => setTimeout(r, 5000));
  // grant coins via transaction
  try {
    const userRef = db.collection("users").doc(user.uid);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const coins = (doc.data().coins || 0) + AD_REWARD;
      tx.update(userRef, { coins });
    });
    addTextBubble("You received +10 coins", "me");
  } catch (err) {
    console.error("Grant coins failed", err);
  }
}

/* Quick click on coin display to show ad popup (test) */
coinValueEl.addEventListener("click", () => {
  if (confirm("Watch an ad to get +10 coins?")) {
    showAdPopup();
  }
});

/* ====== Utility: cleanup peer and local stream ====== */
function cleanupPeer() {
  try { if (pc) pc.close(); } catch (e) {}
  pc = null;
  partnerId = null;
  remoteVideo.srcObject = null;
  // keep localVideo running for quick reconnect; if you want to stop:
  // if (localStream) localStream.getTracks().forEach(t => t.stop());
}

/* ====== Init: handle basic UI state ====== */
(function initUI() {
  nextBtn.disabled = true;
  adPopup.classList.add("hidden");
})();

/* ====== Safety: handle page unload ====== */
window.addEventListener("beforeunload", () => {
  try { socket.disconnect(); } catch (e) {}
});
