const { Server } = require('socket.io');
const env = require('../config/env');
const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokens');
const { setIO, userRoom } = require('./io');

function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.clientUrl, credentials: true } });

  // Every connection must present a valid JWT access token: io(url, { auth: { token } })
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub);
      if (!user || !user.isActive) return next(new Error('Invalid user'));
      socket.data.user = { id: user._id.toString(), role: user.role, name: user.name };
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    // Each user has a private room, so notifications reach only the intended people.
    socket.join(userRoom(id));
    socket.emit('socket:ready', { userId: id, role });
  });

  setIO(io);
  return io;
}

module.exports = initSockets;
