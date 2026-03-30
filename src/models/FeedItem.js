const mongoose = require('mongoose');

const feedItemSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    repostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Repost',
      required: true,
    },
    reposterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // denormalized for fast filtering
    },
  },
  {
    timestamps: true,
  }
);

// ─── PRIMARY FEED QUERY INDEX ─────────────────────────────────────────────────
// "Give me all feed items for user X, newest first"
feedItemSchema.index({ recipientId: 1, createdAt: -1 });

// ─── CLEANUP INDEX ────────────────────────────────────────────────────────────
// "Delete all feed items from reposter Y for recipient X" (used when unfollowing)
feedItemSchema.index({ recipientId: 1, reposterId: 1 });

module.exports = mongoose.model('FeedItem', feedItemSchema);
