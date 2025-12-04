// server.js — stable queue-based signalling
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/ping', (req, res) => res.send('OK'));

let queue = [];

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('joinQueue', (prefs = {}) => {
    // prefs: { gender: 'Male'|'Female'|'Trans'|'' , premium: boolean }
    // Basic FIFO queue — you can extend to preference-based matching later
    if (!queue.find(s => s.id === socket.id)) queue.push({ socket, prefs });
    pairIfPossible();
  });

  socket.on('leaveQueue', () => {
    queue = queue.filter(e => e.socket.id !== socket.id);
  });

  socket.on('next', () => {
    queue = queue.filter(e => e.socket.id !== socket.id);
    queue.push({ socket, prefs: {} });
    pairIfPossible();
  });

  socket.on('signal', (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit('signal', {
      from: socket.id,
      type: data.type,
      payload: data.payload
    });
  });

  socket.on('send-message', ({ to, msg }) => {
    if (!to) return;
    io.to(to).emit('receive-message', { from: socket.id, msg });
  });

  socket.on('send-file', ({ to, file }) => {
    if (!to) return;
    io.to(to).emit('receive-file', { from: socket.id, file });
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    queue = queue.filter(e => e.socket.id !== socket.id);
    io.emit('peer-disconnected', { id: socket.id });
  });
});

function pairIfPossible() {
  // Simple FIFO pairing; ensures both sockets exist
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (a && b) {
      a.socket.emit('paired', { partner: b.socket.id });
      b.socket.emit('paired', { partner: a.socket.id });
      console.log('paired', a.socket.id, '↔', b.socket.id);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat server running on port ${PORT}`));
