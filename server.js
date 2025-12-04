// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/ping', (req, res) => res.send('OK'));

let queue = [];

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('joinQueue', () => {
    if (!queue.includes(socket)) queue.push(socket);
    pair();
  });

  socket.on('leaveQueue', () => {
    queue = queue.filter(s => s.id !== socket.id);
  });

  socket.on('next', () => {
    queue = queue.filter(s => s.id !== socket.id);
    queue.push(socket);
    pair();
  });

  socket.on('signal', (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit('signal', { from: socket.id, type: data.type, payload: data.payload });
  });

  socket.on('send-message', ({ to, msg }) => {
    if (!to) return;
    io.to(to).emit('receive-message', { from: socket.id, msg });
  });

  socket.on('send-image', ({ to, image }) => {
    if (!to || !image) return;
    io.to(to).emit('receive-image', { from: socket.id, image });
  });

  socket.on('send-audio', ({ to, audio }) => {
    if (!to || !audio) return;
    io.to(to).emit('receive-audio', { from: socket.id, audio });
  });

  socket.on('disconnect', () => {
    queue = queue.filter(s => s.id !== socket.id);
    io.emit('peer-disconnected', { id: socket.id });
  });
});

function pair() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    a.emit('paired', { partner: b.id });
    b.emit('paired', { partner: a.id });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat running on ${PORT}`));
