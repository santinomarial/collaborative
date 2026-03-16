const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    language: {
      type: String,
      required: true,
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    collaborators: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    revision: {
      type: Number,
      default: 0,
    },
    snapshot: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Session', sessionSchema);
