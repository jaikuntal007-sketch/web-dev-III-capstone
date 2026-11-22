const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
if (env.nodeEnv !== 'test') app.use(requestLogger);

app.get('/api/health', (req, res) => res.json({ success: true, message: 'API is running', data: { uptime: process.uptime() } }));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
