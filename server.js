/* server.js - QuikChat Global Server
 * Signaling + Firestore + Storage prep
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const admin = require("firebase-admin");
const path = require("path");

// Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Express + Socket
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

// Random match pool
let waitingUsers = [];

// Socket
io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on("find-partner", () => {
    if (waitingUsers.length > 0) {
      const partnerId = waitingUsers.shift();
      io.to(socket.id).emit("partner-found", partnerId);
      io.to(partnerId).emit("partner-found", socket.id);
    } else {
      waitingUsers.push(socket.id);
    }
  });

  socket.on("offer", (data) => io.to(data.to).emit("offer", data));
  socket.on("answer", (data) => io.to(data.to).emit("answer", data));
  socket.on("ice-candidate", (data) => io.to(data.to).emit("ice-candidate", data));

  socket.on("send-message", ({ to, msg }) => {
    io.to(to).emit("receive-message", { msg, from: socket.id });
  });

  socket.on("private-room", ({ to }) => {
    io.to(to).emit("private-request", { from: socket.id });
  });

  socket.on("disconnect", () => {
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    console.log("User disconnected", socket.id);
  });
});

// PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat Server Running on ${PORT}`));
