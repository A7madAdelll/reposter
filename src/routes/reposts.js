const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Repost = require('../models/Repost');
const FeedItem = require('../models/FeedItem');
const Follow = require('../models/Follow');
const { fetchYouTubeMetadata } = require('../utils/youtube');

// ─── CREATE A REPOST ──────────────────────────────────────────────────────────
router.post('/', protect, async (req, res, next) => {
  try {
    const { videoUrl, caption, platform = 'youtube' } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required.' });
    }

    if (platform !== 'youtube') {
      return res.status(400).json({ error: 'Only YouTube is supported at this time.' });
    }

    // Fetch metadata from YouTube oEmbed (no API key needed)
    let metadata;
    try {
      metadata = await fetchYouTubeMetadata(videoUrl);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Check for duplicate repost
    const existing = await Repost.findOne({
      authorId: req.user._id,
      videoId: metadata.videoId,
    });

    if (existing) {
      return res.status(409).json({ error: 'You have already reposted this video.' });
    }

    const repost = await Repost.create({
      authorId: req.user._id,
      platform,
      caption: caption || '',
      ...metadata,
    });

    // Fan-out: add this repost to all accepted followers' feeds
    const followers = await Follow.find({
      followingId: req.user._id,
      status: 'accepted',
    }).select('followerId').lean();

    if (followers.length > 0) {
      const feedItems = followers.map((f) => ({
        recipientId: f.followerId,
        repostId: repost._id,
        reposterId: req.user._id,
      }));
      await FeedItem.insertMany(feedItems, { ordered: false });
    }

    res.status(201).json({ repost });
  } catch (err) {
    next(err);
  }
});

// ─── GET MY REPOSTS ───────────────────────────────────────────────────────────
router.get('/mine', protect, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [reposts, total] = await Promise.all([
      Repost.find({ authorId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Repost.countDocuments({ authorId: req.user._id }),
    ]);

    res.json({
      reposts,
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

// ─── DELETE A REPOST ──────────────────────────────────────────────────────────
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const repost = await Repost.findOne({
      _id: req.params.id,
      authorId: req.user._id,
    });

    if (!repost) {
      return res.status(404).json({ error: 'Repost not found.' });
    }

    await repost.deleteOne();

    // Remove from all followers' feeds
    await FeedItem.deleteMany({ repostId: repost._id });

    res.json({ message: 'Repost deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
