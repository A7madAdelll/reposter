const express = require('express');
const router = express.Router();
const User = require('../models/User');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} = require('../utils/tokens');
const { protect } = require('../middleware/auth');

// ─── REGISTER ────────────────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      const field = existingUser.email === email.toLowerCase() ? 'email' : 'username';
      return res.status(409).json({ error: `This ${field} is already taken.` });
    }

    const user = await User.create({
      username,
      email,
      passwordHash: password, // hashed by pre-save hook
    });

    const accessToken = generateAccessToken(user._id);
    const refreshToken = await generateRefreshToken(user._id);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: user.toPublicProfile(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── LOGIN ───────────────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Must explicitly select passwordHash since it's excluded by default
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = await generateRefreshToken(user._id);

    res.json({
      accessToken,
      refreshToken,
      user: user.toPublicProfile(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── REFRESH ACCESS TOKEN ─────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    let record;
    try {
      record = await verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({ error: err.message, code: 'REFRESH_INVALID' });
    }

    // Rotate refresh token (invalidate old, issue new)
    await revokeRefreshToken(refreshToken);
    const newRefreshToken = await generateRefreshToken(record.userId);
    const accessToken = generateAccessToken(record.userId);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

// ─── LOGOUT ──────────────────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    } else {
      // Logout from all devices
      await revokeAllUserTokens(req.user._id);
    }

    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
