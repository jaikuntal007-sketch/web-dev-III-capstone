const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

const signAccessToken = (user) =>
  jwt.sign({ sub: user._id.toString(), role: user.role }, env.accessSecret, { expiresIn: env.accessExpiry });

const signRefreshToken = (user) =>
  jwt.sign({ sub: user._id.toString(), jti: crypto.randomUUID() }, env.refreshSecret, { expiresIn: env.refreshExpiry });

const verifyAccessToken = (token) => jwt.verify(token, env.accessSecret);
const verifyRefreshToken = (token) => jwt.verify(token, env.refreshSecret);

// Refresh tokens are stored hashed, so a database leak cannot be replayed.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken };
