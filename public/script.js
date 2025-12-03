const socket = io();
let pc;
let partnerId;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = stream;

  pc = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun1.l.google.com:19302"] }]
  });

  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("ice", { to: partnerId, candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };
}

startCamera();

document.getElementById("findBtn").onclick = () => {
  socket.emit("find");
};

socket.on("partner", async (id) => {
  partnerId = id;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { to: partnerId, offer });
});

socket.on("offer", async (data) => {
  partnerId = data.from;

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: partnerId, answer });
});

socket.on("answer", async (data) => {
  await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on("ice", (data) => {
  pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});
