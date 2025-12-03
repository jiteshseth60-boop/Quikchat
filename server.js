// server.js - Complete Backend for QuikChat
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory storage
const users = new Map(); // socket.id -> user data
const queue = {
  male: [],
  female: [],
  other: []
};
const activePairs = new Map(); // socket.id -> partnerId
const privateRooms = new Map(); // roomId -> {users: [], isPaid: boolean}
const reports = new Map(); // userId -> count

// Utility functions
function getCountryFromIP(ip) {
  // Simplified - in production use IP geolocation API
  return 'IN';
}

function containsNudity(text) {
  const badWords = [
    'nude', 'naked', 'sex', 'porn', 'xxx', 'boobs', 'dick', 'pussy',
    'fuck', 'asshole', 'bitch', 'cock', 'vagina', 'penis', 'breasts',
    'undress', 'strip', 'nudity', 'adult', 'erotic'
  ];
  const lower = text.toLowerCase();
  return badWords.some(word => lower.includes(word));
}

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // User registration
  socket.on('register', (userData) => {
    const user = {
      id: socket.id,
      name: userData.name || 'Anonymous',
      gender: userData.gender || 'other',
      country: userData.country || getCountryFromIP(socket.handshake.address),
      age: userData.age || 25,
      coins: userData.coins || 0,
      isPremium: userData.isPremium || false,
      preferences: userData.preferences || {
        gender: 'any',
        country: 'any',
        minAge: 18,
        maxAge: 60
      },
      joinedAt: new Date()
    };
    
    users.set(socket.id, user);
    
    // Send user their ID for private invites
    socket.emit('registered', {
      id: socket.id,
      coins: user.coins,
      isPremium: user.isPremium
    });
    
    // Update online users list
    broadcastOnlineUsers();
  });
  
  // Join random chat queue
  socket.on('join-queue', (preferences) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    // Update preferences if provided
    if (preferences) {
      user.preferences = { ...user.preferences, ...preferences };
    }
    
    // Check if female wants female (requires ad)
    if (user.gender === 'female' && preferences?.gender === 'female') {
      if (!user.isPremium && user.coins < 10) {
        socket.emit('ad-required', { type: 'female-to-female' });
        return;
      }
    }
    
    // Add to appropriate queue
    const genderQueue = queue[user.gender] || queue.other;
    genderQueue.push(user);
    
    socket.emit('queue-update', { position: genderQueue.length });
    
    // Try to match
    matchUsers();
  });
  
  // Leave queue
  socket.on('leave-queue', () => {
    // Remove from all queues
    Object.keys(queue).forEach(gender => {
      const index = queue[gender].findIndex(u => u.id === socket.id);
      if (index > -1) queue[gender].splice(index, 1);
    });
    socket.emit('left-queue');
  });
  
  // Next partner request
  socket.on('next-partner', () => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      // Notify current partner
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partner-left');
        activePairs.delete(partnerId);
      }
      activePairs.delete(socket.id);
      
      // Add back to queue
      const user = users.get(socket.id);
      if (user) {
        const genderQueue = queue[user.gender] || queue.other;
        genderQueue.push(user);
        matchUsers();
      }
    }
  });
  
  // Private chat invite
  socket.on('private-invite', (data) => {
    const { targetId, isPaid } = data;
    const user = users.get(socket.id);
    const targetSocket = io.sockets.sockets.get(targetId);
    
    if (!user || !targetSocket) {
      socket.emit('error', { message: 'User not found' });
      return;
    }
    
    const roomId = `private_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store room info
    privateRooms.set(roomId, {
      users: [socket.id, targetId],
      isPaid: isPaid || false,
      creator: socket.id,
      createdAt: new Date()
    });
    
    // Send invite
    targetSocket.emit('private-invite-received', {
      from: socket.id,
      fromName: user.name,
      roomId,
      isPaid
    });
    
    socket.emit('private-invite-sent', { roomId });
  });
  
  // Accept private invite
  socket.on('private-accept', (data) => {
    const { roomId } = data;
    const room = privateRooms.get(roomId);
    
    if (!room || !room.users.includes(socket.id)) {
      socket.emit('error', { message: 'Invalid invite' });
      return;
    }
    
    // Check if paid room and user has coins
    if (room.isPaid) {
      const user = users.get(socket.id);
      if (user.coins < 10) {
        socket.emit('coins-required', { required: 10, current: user.coins });
        return;
      }
    }
    
    // Join both to room
    socket.join(roomId);
    const otherUserId = room.users.find(id => id !== socket.id);
    const otherSocket = io.sockets.sockets.get(otherUserId);
    if (otherSocket) {
      otherSocket.join(roomId);
    }
    
    // Start room
    room.startedAt = new Date();
    room.status = 'active';
    
    // Start coin deduction timer if paid
    if (room.isPaid) {
      room.interval = setInterval(() => {
        const user = users.get(socket.id);
        const creator = users.get(room.creator);
        
        if (user.coins >= 10) {
          user.coins -= 10;
          creator.coins += 8; // Platform keeps 2 coins
          
          // Update both users
          socket.emit('coins-updated', { coins: user.coins });
          if (otherSocket) {
            otherSocket.emit('coins-updated', { coins: creator.coins });
          }
        } else {
          // End call due to insufficient coins
          io.to(roomId).emit('private-room-ended', { reason: 'insufficient-coins' });
          clearInterval(room.interval);
          privateRooms.delete(roomId);
        }
      }, 60000); // Every minute
    }
    
    // Notify both users
    io.to(roomId).emit('private-room-started', {
      roomId,
      isPaid: room.isPaid,
      partnerId: otherUserId
    });
  });
  
  // WebRTC signaling
  socket.on('signal', (data) => {
    const { to, roomId, signal } = data;
    const targetSocket = io.sockets.sockets.get(to);
    
    if (targetSocket) {
      targetSocket.emit('signal', {
        from: socket.id,
        roomId,
        signal
      });
    }
  });
  
  // Chat message
  socket.on('chat-message', (data) => {
    const { roomId, message, type = 'text' } = data;
    const user = users.get(socket.id);
    
    if (!user) return;
    
    // Nudity detection
    if (type === 'text' && containsNudity(message)) {
      socket.emit('nudity-warning', {
        message: 'Please use private room for such content',
        suggestPrivate: true
      });
      return;
    }
    
    // Broadcast to room
    socket.to(roomId).emit('chat-message', {
      from: socket.id,
      fromName: user.name,
      message,
      type,
      timestamp: new Date()
    });
  });
  
  // File sharing
  socket.on('share-file', (data) => {
    const { roomId, fileName, fileType, dataUrl } = data;
    const user = users.get(socket.id);
    
    // Broadcast file to room (in production, upload to Firebase Storage)
    socket.to(roomId).emit('file-received', {
      from: socket.id,
      fromName: user.name,
      fileName,
      fileType,
      dataUrl,
      timestamp: new Date()
    });
  });
  
  // Report user
  socket.on('report-user', (data) => {
    const { reportedId, reason } = data;
    
    let reportCount = reports.get(reportedId) || 0;
    reportCount++;
    reports.set(reportedId, reportCount);
    
    // If 3+ reports, block user
    if (reportCount >= 3) {
      // Block the user
      const reportedSocket = io.sockets.sockets.get(reportedId);
      if (reportedSocket) {
        reportedSocket.emit('blocked', { reason: 'multiple_reports' });
        reportedSocket.disconnect();
      }
      
      // Notify reporter
      socket.emit('report-success', { message: 'User has been blocked' });
    } else {
      socket.emit('report-success', { message: 'Report recorded' });
    }
  });
  
  // Watch ad for coins
  socket.on('ad-watched', () => {
    const user = users.get(socket.id);
    if (user) {
      user.coins += 5;
      socket.emit('coins-added', { coins: 5, total: user.coins });
    }
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove from queues
    Object.keys(queue).forEach(gender => {
      const index = queue[gender].findIndex(u => u.id === socket.id);
      if (index > -1) queue[gender].splice(index, 1);
    });
    
    // Handle active pair
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partner-disconnected');
      }
      activePairs.delete(socket.id);
      activePairs.delete(partnerId);
    }
    
    // Handle private rooms
    for (const [roomId, room] of privateRooms) {
      if (room.users.includes(socket.id)) {
        // End the private room
        if (room.interval) clearInterval(room.interval);
        
        // Notify other user
        const otherUserId = room.users.find(id => id !== socket.id);
        const otherSocket = io.sockets.sockets.get(otherUserId);
        if (otherSocket) {
          otherSocket.emit('private-room-ended', { reason: 'partner-left' });
        }
        
        privateRooms.delete(roomId);
      }
    }
    
    // Remove user
    users.delete(socket.id);
    
    // Update online users
    broadcastOnlineUsers();
  });
  
  // Helper: Broadcast online users
  function broadcastOnlineUsers() {
    const onlineUsers = Array.from(users.values()).map(user => ({
      id: user.id,
      name: user.name,
      gender: user.gender,
      country: user.country
    }));
    
    io.emit('online-users', onlineUsers);
  }
  
  // Helper: Match users in queue
  function matchUsers() {
    // Try to match male with female first
    if (queue.male.length > 0 && queue.female.length > 0) {
      const male = queue.male.shift();
      const female = queue.female.shift();
      
      createPair(male, female);
      return;
    }
    
    // Match within same gender if preferences allow
    matchGenderQueue('male');
    matchGenderQueue('female');
    matchGenderQueue('other');
    
    // Mixed gender matching
    const allUsers = [...queue.male, ...queue.female, ...queue.other];
    if (allUsers.length >= 2) {
      const user1 = allUsers[0];
      const user2 = allUsers[1];
      
      // Remove from their respective queues
      const queue1 = queue[user1.gender];
      const index1 = queue1.indexOf(user1);
      if (index1 > -1) queue1.splice(index1, 1);
      
      const queue2 = queue[user2.gender];
      const index2 = queue2.indexOf(user2);
      if (index2 > -1) queue2.splice(index2, 1);
      
      createPair(user1, user2);
    }
  }
  
  function matchGenderQueue(gender) {
    const genderQueue = queue[gender];
    
    for (let i = 0; i < genderQueue.length; i++) {
      for (let j = i + 1; j < genderQueue.length; j++) {
        const user1 = genderQueue[i];
        const user2 = genderQueue[j];
        
        // Check preferences
        if ((user1.preferences.gender === 'any' || user1.preferences.gender === user2.gender) &&
            (user2.preferences.gender === 'any' || user2.preferences.gender === user1.gender)) {
          
          // Remove from queue
          genderQueue.splice(j, 1);
          genderQueue.splice(i, 1);
          
          createPair(user1, user2);
          return;
        }
      }
    }
  }
  
  function createPair(user1, user2) {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store active pair
    activePairs.set(user1.id, user2.id);
    activePairs.set(user2.id, user1.id);
    
    // Get sockets
    const socket1 = io.sockets.sockets.get(user1.id);
    const socket2 = io.sockets.sockets.get(user2.id);
    
    if (!socket1 || !socket2) return;
    
    // Join both to room
    socket1.join(roomId);
    socket2.join(roomId);
    
    // Notify both users
    socket1.emit('matched', {
      partner: user2.id,
      roomId,
      partnerInfo: {
        name: user2.name,
        gender: user2.gender,
        country: user2.country,
        age: user2.age
      }
    });
    
    socket2.emit('matched', {
      partner: user1.id,
      roomId,
      partnerInfo: {
        name: user1.name,
        gender: user1.gender,
        country: user1.country,
        age: user1.age
      }
    });
    
    // Log match
    console.log(`Matched: ${user1.name} (${user1.gender}) with ${user2.name} (${user2.gender})`);
  }
});

// API endpoints
app.get('/api/stats', (req, res) => {
  res.json({
    online: users.size,
    inQueue: queue.male.length + queue.female.length + queue.other.length,
    activePairs: activePairs.size / 2,
    privateRooms: privateRooms.size
  });
});

app.get('/api/user/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
