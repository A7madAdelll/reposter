const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
};

const generateRefreshToken = async (userId) => {
  // Secure random token
  const token = crypto.randomBytes(64).toString('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await RefreshToken.create({ userId, token, expiresAt });

  return token;
};

const verifyRefreshToken = async (token) => {
  const record = await RefreshToken.findOne({ token });

  if (!record) throw new Error('Invalid refresh token');
  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    throw new Error('Refresh token expired');
  }

  return record;
};

const revokeRefreshToken = async (token) => {
  await RefreshToken.deleteOne({ token });
};

const revokeAllUserTokens = async (userId) => {
  await RefreshToken.deleteMany({ userId });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
