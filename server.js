// ======================= QuikChat Global Server ==========================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/ping", (req, res) => res.send("OK"));

// --------- Matching Queue ----------
let publicQueue = [];
let privateRooms = {}; 

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Join public chat queue
  socket.on("joinQueue", () => {
    if (!publicQueue.includes(socket)) publicQueue.push(socket);
    tryPair();
  });

  // Leave public queue
  socket.on("leaveQueue", () => {
    publicQueue = publicQueue.filter(s => s.id !== socket.id);
  });

  // --------------- Private room create ---------------
  socket.on("createPrivateRoom", () => {
    const roomId = "room_" + Date.now();
    privateRooms[roomId] = { owner: socket.id, users: [socket.id] };
    socket.join(roomId);
    socket.emit("privateRoomCreated", { roomId });
    console.log("Private room created:", roomId);
  });

  // Join private room with ID
  socket.on("joinPrivateRoom", ({ roomId }) => {
    if (privateRooms[roomId] && privateRooms[roomId].users.length < 2) {
      privateRooms[roomId].users.push(socket.id);
      socket.join(roomId);
      const [a, b] = privateRooms[roomId].users;
      io.to(a).emit("paired", { partner: b });
      io.to(b).emit("paired", { partner: a });
    } else {
      socket.emit("privateRoomFull");
    }
  });

  // --------------- WebRTC Signaling ---------------
  socket.on("signal", (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit("signal", {
      from: socket.id,
      type: data.type,
      payload: data.payload
    });
  });

  // Skip / Next partner in public mode
  socket.on("next", () => {
    publicQueue = publicQueue.filter(s => s.id !== socket.id);
    publicQueue.push(socket);
    tryPair();
  });

  // ---- Report (nudity / abuse) ----
  socket.on("reportUser", ({ target }) => {
    console.log("Report received for:", target);
    io.to(target).emit("warned");
  });

  // ----------- Disconnect -----------
  socket.on("disconnect", () => {
    publicQueue = publicQueue.filter(s => s.id !== socket.id);

    // notify partner
    io.emit("peer-disconnected", { id: socket.id });

    console.log("Disconnected:", socket.id);
  });
});

// -------- Pairing Logic ----------
function tryPair() {
  while (publicQueue.length >= 2) {
    const a = publicQueue.shift();
    const b = publicQueue.shift();
    a.emit("paired", { partner: b.id });
    b.emit("paired", { partner: a.id });
    console.log("Paired:", a.id, "<-->", b.id);
  }
}

// ----------------- Start Server ----------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🔥 QuikChat Global running on port ${PORT}`)
);
