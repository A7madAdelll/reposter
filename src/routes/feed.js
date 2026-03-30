const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const FeedItem = require('../models/FeedItem');

// ─── GET MY FEED ──────────────────────────────────────────────────────────────
// Returns paginated reposts from all users I follow
router.get('/', protect, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      FeedItem.find({ recipientId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'repostId',
          select: 'platform videoId videoUrl title thumbnailUrl channelName caption createdAt',
        })
        .populate({
          path: 'reposterId',
          select: 'username avatarUrl',
        })
        .lean(),
      FeedItem.countDocuments({ recipientId: req.user._id }),
    ]);

    // Filter out feed items where repost was deleted
    const feed = items
      .filter((item) => item.repostId !== null)
      .map((item) => ({
        feedItemId: item._id,
        repostedBy: item.reposterId,
        repost: item.repostId,
        repostedAt: item.createdAt,
      }));

    res.json({
      feed,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
