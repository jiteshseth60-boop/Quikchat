// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// serve static
app.use(express.static(path.join(__dirname, 'public')));

// simple health route
app.get('/ping', (req, res) => res.send('OK'));

// queue & pairing (simple FIFO)
let queue = [];

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('joinQueue', () => {
    if (!queue.find(s => s.id === socket.id)) {
      queue.push(socket);
    }
    pairIfPossible();
  });

  socket.on('leaveQueue', () => {
    queue = queue.filter(s => s.id !== socket.id);
  });

  socket.on('next', () => {
    queue = queue.filter(s => s.id !== socket.id);
    queue.push(socket);
    pairIfPossible();
  });

  // generic signal passthrough
  socket.on('signal', (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit('signal', {
      from: socket.id,
      type: data.type,
      payload: data.payload
    });
  });

  // Private room
  socket.on('private-request', ({ to }) => {
    if (!to) return;
    io.to(to).emit('private-request', { from: socket.id });
  });

  socket.on('private-accept', ({ to }) => {
    if (!to) return;
    io.to(to).emit('private-accept', { from: socket.id });
  });

  // TEXT MESSAGE
  socket.on('send-message', ({ to, msg, meta }) => {
    if (!to) return;
    io.to(to).emit('receive-message', { from: socket.id, msg, meta });
  });

  // IMAGE SEND
  socket.on('send-image', ({ to, image }) => {
    if (!to || !image) return;
    io.to(to).emit('receive-image', { from: socket.id, image });
  });

  // AUDIO / MUSIC SEND
  socket.on('send-audio', ({ to, audio }) => {
    if (!to || !audio) return;
    io.to(to).emit('receive-audio', { from: socket.id, audio });
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    queue = queue.filter(s => s.id !== socket.id);
    io.emit('peer-disconnected', { id: socket.id });
  });
});

// matching
function pairIfPossible() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (a && b) {
      a.emit('paired', { partner: b.id });
      b.emit('paired', { partner: a.id });
      console.log('paired', a.id, '↔', b.id);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat server running on port ${PORT}`));
