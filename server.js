// server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
// Increase Express body limit for large Base64 image data (if needed later for moderation)
app.use(express.static(__dirname + "/public"));
app.get("/google9d84c28f333347f1.html", (req, res) => {
  res.sendFile(__dirname + "/public/google9d84c28f333347f1.html");
});

// robots.txt route
app.get("/robots.txt", (req, res) => {
  res.sendFile(__dirname + "/robots.txt");
});
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  // Max buffer size increased to handle Base64 image data for verification/moderation
  maxHttpBufferSize: 10e6 // 10MB limit (original was 1e6 = 1MB)
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

// Utility function to handle the core matching logic
function attemptMatch(socket, opts) {
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

            const room = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
        console.error("attemptMatch error:", e);
    }
}

// -------------------------------------------------------------
// AI Age Verification Mock Function (Integrate your actual API here)
async function verifyAgeWithAI(imageData) {
    // --- THIS IS MOCK/DEMO LOGIC ---
    // Here you would integrate Azure/AWS/KYC API call.
    // The API processes the image and returns an age prediction or status.

    // Example: 90% chance of passing verification for demo
    const isAdult = Math.random() > 0.1; 
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate API delay

    if (isAdult) {
        console.log(`Age check passed for ${socket.id}`);
        return true;
    } else {
        console.log(`Age check failed for ${socket.id}`);
        return false;
    }
    // --- END OF MOCK LOGIC ---
}
// -------------------------------------------------------------


io.on("connection", (socket) => {
    io.emit("admin-stats", { connected: io.engine.clientsCount });
    console.log("Connected:", socket.id);

    // FIND PARTNER (Standard Public Match)
    socket.on("findPartner", (opts = {}) => {
        // Standard call for public matching (wantPrivate: false is assumed)
        attemptMatch(socket, opts);
    });

    // --------------------------------------------------------------------------------
    // NEW EVENT: Age Verification + Find Partner (For Private Match)
    socket.on("verifyAgeAndFindPartner", async (opts = {}) => {
        const imageData = opts.image;

        if (!imageData) {
            console.warn(`Verification failed: No image data from ${socket.id}`);
            socket.emit("ageRejected");
            return;
        }
        
        // 1. Run Age Verification (Mock API call)
        const isVerified = await verifyAgeWithAI(imageData);

        if (isVerified) {
            // 2. Age is OK. Proceed to matching (opts already has wantPrivate: true)
            // Inform client that verification succeeded before matching starts
            socket.emit("verificationSuccessful"); 
            attemptMatch(socket, opts);
        } else {
            // 3. Age failed. Reject access.
            socket.emit("ageRejected");
            
            // OPTIONAL: Ban user from Private Queue permanently here
        }
    });
    // --------------------------------------------------------------------------------

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
    
    // REPORT
    socket.on("report", (data) => {
        console.log("REPORT RECEIVED:", data);

        // Store report data here for later review
        io.emit("admin-report", data);
    });

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
