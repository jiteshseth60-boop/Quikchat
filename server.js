// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static
app.use(express.static(path.join(__dirname, 'public')));

// simple health route
app.get('/ping', (req, res) => res.send('OK'));

// queue & pairing
let queue = [];

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('joinQueue', () => {
    console.log('joinQueue from', socket.id);
    // avoid duplicates
    if (!queue.includes(socket)) queue.push(socket);

    // try pair
    pairIfPossible();
  });

  socket.on('leaveQueue', () => {
    queue = queue.filter(s => s.id !== socket.id);
  });

  socket.on('signal', (data) => {
    // data: { to, type, payload }
    if (!data || !data.to) return;
    io.to(data.to).emit('signal', {
      from: socket.id,
      type: data.type,
      payload: data.payload
    });
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // remove from queue if present
    queue = queue.filter(s => s.id !== socket.id);
    // inform any partner (server doesn't maintain pairs long-term)
    io.emit('peer-disconnected', { id: socket.id });
  });

  // next (user wants next partner)
  socket.on('next', () => {
    // try to remove socket from queue and re-join to get a new partner
    queue = queue.filter(s => s.id !== socket.id);
    queue.push(socket);
    pairIfPossible();
  });
});

function pairIfPossible() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();

    if (a && b) {
      // create a temporary "room" id (we'll use socket ids for signalling)
      a.emit('paired', { partner: b.id });
      b.emit('paired', { partner: a.id });
      console.log('paired', a.id, '↔', b.id);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat server running on port ${PORT}`));
