// server.js - QuikChat final server (signaling + queue + private invite + uploads)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Ensure uploads folder exists
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Static serve (public + uploads)
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// Simple health route
app.get("/ping", (req, res) => res.send("OK"));

// Multer setup for file uploads (images/audio)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext).replace(/\s+/g, "_");
      cb(null, `${Date.now()}_${name}${ext}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB limit
  fileFilter: (req, file, cb) => {
    // Allow images and audio (jpg/jpeg/png/gif/mp3/m4a/wav)
    const allowed = /jpeg|jpg|png|gif|mp3|m4a|wav|ogg/;
    const mimetype = allowed.test((file.mimetype || "").toLowerCase());
    const ext = allowed.test((path.extname(file.originalname) || "").toLowerCase());
    if (mimetype || ext) cb(null, true);
    else cb(new Error("File type not allowed"), false);
  }
});

// Upload endpoint — returns public URL
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
  const publicUrl = `/uploads/${req.file.filename}`;
  return res.json({ ok: true, url: publicUrl, name: req.file.originalname });
});

// -------------------- Socket logic --------------------
/*
 Protocol (socket events):
 - joinQueue               -> user enters public queue
 - leaveQueue              -> remove from queue
 - invitePrivate -> { to } -> send invite to a partner
 - acceptInvite -> { from } -> the invited user accepts (server pairs them in private room)
 - signal -> { to, type, payload } -> generic signaling relay (offer/answer/ice)
 - chat-message -> { to, text } -> send text to partner (or room)
 - file-message -> { to, url, name, mime } -> notify partner of uploaded file
 - reportUser -> { target } -> report user (server warns)
 - next / disconnect handled
*/

let publicQueue = [];            // sockets in public queue
const pendingInvites = {};       // inviteId -> { from, to }
const userToSocket = {};         // map socket.id -> socket (optional convenience)
const privateRooms = {};         // roomId -> { users: [id,id], owner }

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);
  userToSocket[socket.id] = socket;

  // ---------- Queue ----------
  socket.on("joinQueue", () => {
    if (!publicQueue.includes(socket.id)) {
      publicQueue.push(socket.id);
      socket.emit("queueJoined");
      tryPair(); // attempt immediate pairing
    }
  });

  socket.on("leaveQueue", () => {
    publicQueue = publicQueue.filter(id => id !== socket.id);
    socket.emit("queueLeft");
  });

  socket.on("next", () => {
    publicQueue = publicQueue.filter(id => id !== socket.id);
    publicQueue.push(socket.id);
    socket.emit("nextQueued");
    tryPair();
  });

  // ---------- Invite to private ----------
  // client sends: socket.emit('invitePrivate', { to: partnerSocketId });
  socket.on("invitePrivate", ({ to }) => {
    if (!to || !io.sockets.sockets.get(to)) {
      return socket.emit("inviteFailed", { reason: "User not online" });
    }
    // send invite
    const inviteId = `inv_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    pendingInvites[inviteId] = { from: socket.id, to };
    io.to(to).emit("privateInvite", { inviteId, from: socket.id });
    socket.emit("inviteSent", { inviteId, to });
  });

  // invited user accepts: socket.emit('acceptInvite', { inviteId });
  socket.on("acceptInvite", ({ inviteId }) => {
    const invite = pendingInvites[inviteId];
    if (!invite) return socket.emit("inviteFailed", { reason: "Invite expired" });

    const a = invite.from;
    const b = invite.to;
    // new private room id
    const roomId = `priv_${Date.now()}_${Math.random().toString(36, 4)}`;
    privateRooms[roomId] = { users: [a, b], owner: a };

    // make both join socket.io room
    io.sockets.sockets.get(a)?.join(roomId);
    io.sockets.sockets.get(b)?.join(roomId);

    // notify both with paired info and room id
    io.to(a).emit("pairedPrivate", { partner: b, roomId });
    io.to(b).emit("pairedPrivate", { partner: a, roomId });

    // cleanup invite
    delete pendingInvites[inviteId];
  });

  socket.on("rejectInvite", ({ inviteId }) => {
    const invite = pendingInvites[inviteId];
    if (!invite) return;
    const from = invite.from;
    io.to(from).emit("inviteRejected", { inviteId, by: socket.id });
    delete pendingInvites[inviteId];
  });

  // ---------- Signaling relay ----------
  socket.on("signal", (data) => {
    // data: { to, type, payload }
    if (!data || !data.to) return;
    io.to(data.to).emit("signal", {
      from: socket.id,
      type: data.type,
      payload: data.payload
    });
  });

  // ---------- Chat messaging ----------
  // client: socket.emit('chat-message', { to, text })
  socket.on("chat-message", ({ to, text }) => {
    if (!to) return;
    io.to(to).emit("chat-message", { from: socket.id, text });
  });

  // ---------- File message relay (after upload) ----------
  // client uploads /upload then emits file-message with url and to
  socket.on("file-message", ({ to, url, name, mime }) => {
    if (!to || !url) return;
    io.to(to).emit("file-message", { from: socket.id, url, name, mime });
  });

  // ---------- Report user ----------
  socket.on("reportUser", ({ target }) => {
    if (!target) return;
    // Basic warn relay — server-side moderation system can be implemented later
    io.to(target).emit("warned", { by: socket.id });
    // Log server-side (for admin review)
    console.log(`Report: ${socket.id} reported ${target}`);
  });

  // ---------- Disconnect ----------
  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
    publicQueue = publicQueue.filter(id => id !== socket.id);

    // remove from invites if any side had pending
    for (const k of Object.keys(pendingInvites)) {
      if (pendingInvites[k].from === socket.id || pendingInvites[k].to === socket.id) {
        delete pendingInvites[k];
      }
    }

    // leave any private rooms
    for (const rid of Object.keys(privateRooms)) {
      const room = privateRooms[rid];
      room.users = room.users.filter(u => u !== socket.id);
      if (room.users.length === 0) delete privateRooms[rid];
      else {
        // notify remaining user
        io.to(room.users[0]).emit("partnerDisconnected", { id: socket.id, roomId: rid });
      }
    }

    delete userToSocket[socket.id];
  });

});

// ---------------- pairing helper ----------------
function tryPair() {
  while (publicQueue.length >= 2) {
    const aId = publicQueue.shift();
    const bId = publicQueue.shift();
    const aSock = io.sockets.sockets.get(aId);
    const bSock = io.sockets.sockets.get(bId);
    if (!aSock || !bSock) {
      if (aSock) publicQueue.unshift(aId);
      if (bSock) publicQueue.unshift(bId);
      break;
    }
    // Notify both; clients will start offer/answer via 'signal'
    aSock.emit("paired", { partner: bId });
    bSock.emit("paired", { partner: aId });
    console.log("Paired public:", aId, "<->", bId);
  }
}

// ---------------- start server ----------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat server running on ${PORT}`));
