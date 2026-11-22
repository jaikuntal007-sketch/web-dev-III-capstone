const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const jwt = require('jsonwebtoken');
const {
  signAccessToken, signRefreshToken, verifyRefreshToken, hashToken,
} = require('../utils/tokens');

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const { exp } = jwt.decode(refreshToken);
  await RefreshToken.create({ user: user._id, tokenHash: hashToken(refreshToken), expiresAt: new Date(exp * 1000) });
  return { accessToken, refreshToken };
}

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  // Same message for unknown email and wrong password: do not reveal which accounts exist.
  if (!user || !(await user.comparePassword(password))) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
  const tokens = await issueTokens(user);
  sendSuccess(res, { user, ...tokens }, 'Login successful');
};

// Refresh-token rotation: the old token is deleted and a new pair is issued.
exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
  const stored = await RefreshToken.findOneAndDelete({ tokenHash: hashToken(refreshToken), user: payload.sub });
  if (!stored) throw ApiError.unauthorized('Refresh token has been revoked');
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('User no longer exists or is inactive');
  const tokens = await issueTokens(user);
  sendSuccess(res, tokens, 'Token refreshed');
};

exports.logout = async (req, res) => {
  await RefreshToken.deleteOne({ tokenHash: hashToken(req.body.refreshToken), user: req.user._id });
  sendSuccess(res, null, 'Logged out successfully');
};

exports.me = async (req, res) => sendSuccess(res, req.user);

// Administrator-controlled user creation (there is no public sign-up).
exports.register = async (req, res) => {
  const { name, email, password, role, rollNumber, department, phone } = req.body;
  const user = await User.create({ name, email, password, role, rollNumber, department, phone });
  sendSuccess(res, user, 'User created successfully', 201);
};
