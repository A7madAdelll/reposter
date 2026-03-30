const mongoose = require('mongoose');

const repostSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    platform: {
      type: String,
      enum: ['youtube'], // extensible — add 'instagram', 'twitter' etc. later
      required: true,
    },
    videoId: {
      type: String,
      required: true, // YouTube video ID e.g. "dQw4w9WgXcQ"
    },
    videoUrl: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    thumbnailUrl: {
      type: String,
      required: true,
    },
    channelName: {
      type: String,
      default: null,
    },
    caption: {
      type: String,
      maxlength: [500, 'Caption must be at most 500 characters'],
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// ─── PREVENT DUPLICATE REPOSTS FROM SAME USER ────────────────────────────────
repostSchema.index({ authorId: 1, videoId: 1 }, { unique: true });

// ─── INDEX FOR FEED QUERIES ───────────────────────────────────────────────────
repostSchema.index({ authorId: 1, createdAt: -1 });

module.exports = mongoose.model('Repost', repostSchema);
