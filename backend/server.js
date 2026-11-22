const http = require('http');
const env = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const initSockets = require('./sockets');
const registerListeners = require('./events/listeners');

async function start() {
  await connectDB();
  const server = http.createServer(app);
  initSockets(server);
  registerListeners();
  server.listen(env.port, () => console.log(`Server running on http://localhost:${env.port}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
