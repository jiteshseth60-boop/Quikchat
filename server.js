// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

// Simple in-memory matchmaking + private rooms
let queue = [];            // array of socket.id
let partners = {};         // partners[socketId] = partnerSocketId
let privateSessions = {};  // privateSessions[roomId] = {a, b, startedAt}

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  socket.on("find", () => {
    if (queue.length > 0) {
      const partnerId = queue.shift();
      if (partnerId === socket.id) return;
      partners[socket.id] = partnerId;
      partners[partnerId] = socket.id;
      io.to(socket.id).emit("matched", { partner: partnerId });
      io.to(partnerId).emit("matched", { partner: socket.id });
      console.log("paired", socket.id, partnerId);
    } else {
      queue.push(socket.id);
      io.to(socket.id).emit("waiting");
    }
  });

  // leave queue
  socket.on("leave", () => {
    queue = queue.filter(id => id !== socket.id);
  });

  // generic signal relay (offer/answer/ice)
  socket.on("signal", (data) => {
    // data: { to, payload }
    if (data && data.to) io.to(data.to).emit("signal", { from: socket.id, payload: data.payload });
  });

  // chat message relay
  socket.on("chat", (msg) => {
    const p = partners[socket.id];
    if (p) io.to(p).emit("chat", { from: socket.id, text: msg });
  });

  // private room request: send request to partner
  socket.on("private-request", (info) => {
    const partner = partners[socket.id];
    if (partner) {
      // info may contain: pricePerMinute (coins)
      io.to(partner).emit("private-request", { from: socket.id, pricePerMinute: info.pricePerMinute || 10 });
    }
  });

  // when partner accepts private, notify both and mark private session
  socket.on("private-accept", (data) => {
    // data: { with: requesterId, roomId }
    const requester = data.with;
    const roomId = data.roomId || `${requester}_${socket.id}_${Date.now()}`;
    privateSessions[roomId] = { a: requester, b: socket.id, startedAt: Date.now() };
    // notify both with roomId
    io.to(requester).emit("private-start", { roomId, partner: socket.id });
    io.to(socket.id).emit("private-start", { roomId, partner: requester });
  });

  // when private ends
  socket.on("private-end", (roomId) => {
    if (privateSessions[roomId]) {
      const s = privateSessions[roomId];
      io.to(s.a).emit("private-ended", { roomId });
      io.to(s.b).emit("private-ended", { roomId });
      delete privateSessions[roomId];
    }
  });

  // cleanup on disconnect
  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);
    queue = queue.filter(id => id !== socket.id);
    const p = partners[socket.id];
    if (p) {
      io.to(p).emit("partner-left");
      delete partners[p];
      delete partners[socket.id];
    }

    // remove any private sessions involving this socket
    Object.keys(privateSessions).forEach(roomId => {
      const s = privateSessions[roomId];
      if (s.a === socket.id || s.b === socket.id) {
        if (s.a && s.b) {
          io.to(s.a).emit("private-ended", { roomId });
          io.to(s.b).emit("private-ended", { roomId });
        }
        delete privateSessions[roomId];
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
