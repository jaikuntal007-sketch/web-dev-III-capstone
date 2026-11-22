// Holds the Socket.IO server instance so services can emit without importing the HTTP server.
let ioInstance = null;
module.exports = {
  setIO: (io) => { ioInstance = io; },
  getIO: () => ioInstance,
  userRoom: (userId) => `user:${userId}`,
};
