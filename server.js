// server.js - FINAL QuikChat Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// static files
app.use(express.static(path.join(__dirname, 'public')));

// queue array
let queue = [];

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('joinQueue', (data) => {
    if (!queue.find(s => s.id === socket.id)) queue.push(socket);
    pairUsers();
  });

  socket.on('leaveQueue', () => {
    queue = queue.filter(s => s.id !== socket.id);
  });

  socket.on('next', () => {
    queue = queue.filter(s => s.id !== socket.id);
    queue.push(socket);
    pairUsers();
  });

  // WebRTC signaling
  socket.on('signal', (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit('signal', {
      from: socket.id,
      type: data.type,
      payload: data.payload
    });
  });

  // ------------- FILE TRANSFER (image/audio/video) -------------
  socket.on('file', (msg) => {
    const { to, type, name, data } = msg;
    if (!to || !data) return;
    io.to(to).emit('file', {
      from: socket.id,
      payload: { type, name, data }
    });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    queue = queue.filter(s => s.id !== socket.id);
    io.emit('peer-disconnected', { id: socket.id });
  });
});

function pairUsers(){
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    a.emit('paired', { partner: b.id });
    b.emit('paired', { partner: a.id });
    console.log(`Paired ${a.id}  <==>  ${b.id}`);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
