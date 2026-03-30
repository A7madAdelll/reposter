const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Follow = require('../models/Follow');
const FeedItem = require('../models/FeedItem');
const Repost = require('../models/Repost');

// ─── GET MY FOLLOWING LIST ────────────────────────────────────────────────────
// Users that I follow (accepted)
router.get('/following', protect, async (req, res, next) => {
  try {
    const follows = await Follow.find({
      followerId: req.user._id,
      status: 'accepted',
    }).populate('followingId', 'username avatarUrl followCode');

    const following = follows.map((f) => f.followingId);
    res.json({ following });
  } catch (err) {
    next(err);
  }
});

// ─── GET MY FOLLOWERS LIST ────────────────────────────────────────────────────
// Users that follow me (accepted)
router.get('/followers', protect, async (req, res, next) => {
  try {
    const follows = await Follow.find({
      followingId: req.user._id,
      status: 'accepted',
    }).populate('followerId', 'username avatarUrl followCode');

    const followers = follows.map((f) => ({
      followId: f._id,
      user: f.followerId,
    }));

    res.json({ followers });
  } catch (err) {
    next(err);
  }
});

// ─── GET MY FOLLOW REQUESTS ───────────────────────────────────────────────────
// Pending incoming requests
router.get('/follow-requests', protect, async (req, res, next) => {
  try {
    const requests = await Follow.find({
      followingId: req.user._id,
      status: 'pending',
    }).populate('followerId', 'username avatarUrl');

    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// ─── SEND FOLLOW REQUEST BY CODE ──────────────────────────────────────────────
router.post('/follow/:code', protect, async (req, res, next) => {
  try {
    const { code } = req.params;

    const targetUser = await User.findOne({ followCode: code.toUpperCase() });
    if (!targetUser) {
      return res.status(404).json({ error: 'No user found with that follow code.' });
    }

    if (targetUser._id.equals(req.user._id)) {
      return res.status(400).json({ error: 'You cannot follow yourself.' });
    }

    const existing = await Follow.findOne({
      followerId: req.user._id,
      followingId: targetUser._id,
    });

    if (existing) {
      const msg =
        existing.status === 'accepted'
          ? 'You are already following this user.'
          : 'Follow request already sent.';
      return res.status(409).json({ error: msg });
    }

    const follow = await Follow.create({
      followerId: req.user._id,
      followingId: targetUser._id,
      status: 'pending', // always requires approval
    });

    res.status(201).json({
      message: 'Follow request sent.',
      targetUser: targetUser.toPublicProfile(),
      followId: follow._id,
    });
  } catch (err) {
    next(err);
  }
});

// ─── ACCEPT A FOLLOW REQUEST ──────────────────────────────────────────────────
router.post('/follow-requests/:id/accept', protect, async (req, res, next) => {
  try {
    const follow = await Follow.findOne({
      _id: req.params.id,
      followingId: req.user._id,
      status: 'pending',
    });

    if (!follow) {
      return res.status(404).json({ error: 'Follow request not found.' });
    }

    follow.status = 'accepted';
    await follow.save();

    // Fan-out existing reposts from the newly accepted user to the follower's feed
    const existingReposts = await Repost.find({ authorId: req.user._id }).select('_id').lean();

    if (existingReposts.length > 0) {
      const feedItems = existingReposts.map((r) => ({
        recipientId: follow.followerId,
        repostId: r._id,
        reposterId: req.user._id,
      }));
      await FeedItem.insertMany(feedItems, { ordered: false }).catch(() => {}); // ignore duplicates
    }

    res.json({ message: 'Follow request accepted.' });
  } catch (err) {
    next(err);
  }
});

// ─── REJECT A FOLLOW REQUEST ──────────────────────────────────────────────────
router.post('/follow-requests/:id/reject', protect, async (req, res, next) => {
  try {
    const follow = await Follow.findOneAndDelete({
      _id: req.params.id,
      followingId: req.user._id,
      status: 'pending',
    });

    if (!follow) {
      return res.status(404).json({ error: 'Follow request not found.' });
    }

    res.json({ message: 'Follow request rejected.' });
  } catch (err) {
    next(err);
  }
});

// ─── UNFOLLOW SOMEONE ─────────────────────────────────────────────────────────
router.delete('/following/:userId', protect, async (req, res, next) => {
  try {
    const follow = await Follow.findOneAndDelete({
      followerId: req.user._id,
      followingId: req.params.userId,
    });

    if (!follow) {
      return res.status(404).json({ error: 'You are not following this user.' });
    }

    // Remove their reposts from your feed
    await FeedItem.deleteMany({
      recipientId: req.user._id,
      reposterId: req.params.userId,
    });

    res.json({ message: 'Unfollowed successfully.' });
  } catch (err) {
    next(err);
  }
});

// ─── REMOVE A FOLLOWER ────────────────────────────────────────────────────────
router.delete('/followers/:userId', protect, async (req, res, next) => {
  try {
    const follow = await Follow.findOneAndDelete({
      followerId: req.params.userId,
      followingId: req.user._id,
    });

    if (!follow) {
      return res.status(404).json({ error: 'This user is not your follower.' });
    }

    // Remove your reposts from their feed
    await FeedItem.deleteMany({
      recipientId: req.params.userId,
      reposterId: req.user._id,
    });

    res.json({ message: 'Follower removed.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
