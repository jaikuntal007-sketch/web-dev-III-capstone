const mongoose = require('mongoose');

// One document per active login session. Deleting the document invalidates the token (logout).
const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  // TTL index: MongoDB removes the document automatically once expiresAt has passed.
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
