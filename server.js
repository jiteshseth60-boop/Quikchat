// server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.static(__dirname + "/public"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;

let waiting = [];

// send admin stats
function broadcastAdminStats() {
  io.emit("admin-stats", {
    connected: io.engine.clientsCount || 0,
    waiting: waiting.length,
  });
}
setInterval(broadcastAdminStats, 2000);

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // FIND PARTNER
  socket.on("findPartner", (opts = {}) => {
    try {
      socket.meta = {
        gender: opts.gender || "any",
        country: opts.country || "any",
        wantPrivate: !!opts.wantPrivate,
        coins: opts.coins || 0,
        name: opts.name || null,
        timestamp: Date.now()
      };

      // remove previously stored socket
      waiting = waiting.filter(w => w.id !== socket.id);

      // find match
      const matchIndex = waiting.findIndex(w => {
        if (!w || !w.socket?.connected || w.id === socket.id) return false;

        const genderOK = (socket.meta.gender === "any" || w.meta.gender === "any" || socket.meta.gender === w.meta.gender);
        const countryOK = (socket.meta.country === "any" || w.meta.country === "any" || socket.meta.country === w.meta.country);
        const privateOK = !(socket.meta.wantPrivate ^ w.meta.wantPrivate);

        return genderOK && countryOK && privateOK;
      });

      if (matchIndex !== -1) {
        const partner = waiting.splice(matchIndex, 1)[0];

        const room = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
        socket.join(room);
        partner.socket.join(room);

        socket.room = room;
        partner.socket.room = room;

        socket.emit("partnerFound", { room, partnerId: partner.id, initiator: true, partnerMeta: partner.meta });
        partner.socket.emit("partnerFound", { room, partnerId: socket.id, initiator: false, partnerMeta: socket.meta });

        console.log(`Paired: ${socket.id} <-> ${partner.id} | Room: ${room}`);
      } else {
        waiting.push({ id: socket.id, socket, meta: socket.meta });
        socket.emit("waiting");
      }

      broadcastAdminStats();
    } catch (e) {
      console.error("findPartner error:", e);
    }
  });

  // SIGNALING
  socket.on("offer", (p) => {
    if (socket.room) socket.to(socket.room).emit("offer", { type: "offer", sdp: p.sdp });
  });
  socket.on("answer", (p) => {
    if (socket.room) socket.to(socket.room).emit("answer", { type: "answer", sdp: p.sdp });
  });
  socket.on("candidate", (c) => {
    if (socket.room) socket.to(socket.room).emit("candidate", { candidate: c });
  });

  // CHAT / IMAGE / STICKER
  socket.on("image", (d) => socket.room && socket.to(socket.room).emit("image", d));
  socket.on("sticker", (d) => socket.room && socket.to(socket.room).emit("sticker", d));
  socket.on("chat", (d) => socket.room && socket.to(socket.room).emit("chat", d));

  // LEAVE ROOM
  socket.on("leave", () => {
    if (socket.room) {
      socket.to(socket.room).emit("peer-left");
      socket.leave(socket.room);
      socket.room = null;
    }
    waiting = waiting.filter(w => w.id !== socket.id);
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    waiting = waiting.filter(w => w.id !== socket.id);
    if (socket.room) socket.to(socket.room).emit("peer-left");
    socket.room = null;
    broadcastAdminStats();
    console.log("Disconnected:", socket.id);
  });
});

app.get("/", (req, res) => res.send("QuikChat signaling server running"));
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
