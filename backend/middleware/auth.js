const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/tokens');

// Reads "Authorization: Bearer <token>", verifies it and attaches the user to req.user.
async function protect(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw ApiError.unauthorized('No access token provided');
  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch (err) {
    throw ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('User no longer exists or is inactive');
  req.user = user;
  next();
}

// Role-based access control: authorize('admin', 'faculty')
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    throw ApiError.forbidden(`Role "${req.user.role}" is not allowed to access this resource`);
  }
  next();
};

module.exports = { protect, authorize };
