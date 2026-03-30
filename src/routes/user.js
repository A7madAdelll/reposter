const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { uploadAvatar, deleteImage } = require('../utils/cloudinary');

// Multer: store in memory, 5MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  },
});

// ─── GET MY PROFILE ───────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res, next) => {
  try {
    res.json({ user: req.user.toPublicProfile() });
  } catch (err) {
    next(err);
  }
});

// ─── UPDATE USERNAME ──────────────────────────────────────────────────────────
router.put('/me', protect, async (req, res, next) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const existing = await User.findOne({ username, _id: { $ne: req.user._id } });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken.' });
    }

    req.user.username = username;
    await req.user.save();

    res.json({ user: req.user.toPublicProfile() });
  } catch (err) {
    next(err);
  }
});

// ─── UPDATE AVATAR ────────────────────────────────────────────────────────────
router.put('/me/avatar', protect, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    // Delete old avatar from Cloudinary if it exists
    if (req.user.avatarPublicId) {
      await deleteImage(req.user.avatarPublicId);
    }

    const { url, publicId } = await uploadAvatar(req.file.buffer, req.user._id);

    req.user.avatarUrl = url;
    req.user.avatarPublicId = publicId;
    await req.user.save();

    res.json({ user: req.user.toPublicProfile() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
