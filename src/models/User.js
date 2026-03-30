const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must be at most 30 characters'],
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // never returned in queries by default
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    avatarPublicId: {
      type: String,
      default: null, // Cloudinary public ID for deletion
    },
    followCode: {
      type: String,
      unique: true,
      default: () => {
        // Generates codes like "X7K2-PQ91"
        const part1 = nanoid(4).toUpperCase();
        const part2 = nanoid(4).toUpperCase();
        return `${part1}-${part2}`;
      },
    },
  },
  {
    timestamps: true,
  }
);

// ─── HASH PASSWORD BEFORE SAVE ───────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// ─── COMPARE PASSWORD ────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// ─── SAFE PUBLIC PROFILE ─────────────────────────────────────────────────────
userSchema.methods.toPublicProfile = function () {
  return {
    _id: this._id,
    username: this.username,
    avatarUrl: this.avatarUrl,
    followCode: this.followCode,
  };
};

module.exports = mongoose.model('User', userSchema);
