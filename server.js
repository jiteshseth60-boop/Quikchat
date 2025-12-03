const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    if (waitingUser && waitingUser !== socket.id) {
      io.to(waitingUser).emit("partner", socket.id);
      socket.emit("partner", waitingUser);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", data);
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", data);
  });

  socket.on("ice", (data) => {
    io.to(data.to).emit("ice", data);
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log("SERVER RUNNING ON PORT " + PORT));
