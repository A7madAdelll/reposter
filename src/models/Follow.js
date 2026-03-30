const mongoose = require('mongoose');

const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    followingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

// ─── PREVENT DUPLICATE FOLLOW REQUESTS ───────────────────────────────────────
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

// ─── INDEX FOR FAST LOOKUPS ───────────────────────────────────────────────────
followSchema.index({ followingId: 1, status: 1 }); // "who follows me?"
followSchema.index({ followerId: 1, status: 1 });  // "who am I following?"

module.exports = mongoose.model('Follow', followSchema);
