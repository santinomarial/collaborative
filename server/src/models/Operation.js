const mongoose = require('mongoose');

const opComponentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['insert', 'delete', 'retain'],
      required: true,
    },
    position: {
      type: Number,
    },
    text: {
      type: String,
    },
    length: {
      type: Number,
    },
  },
  { _id: false }
);

const operationSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
  },
  revision: {
    type: Number,
    required: true,
  },
  ops: [opComponentSchema],
  timestamp: {
    type: Date,
    default: Date.now,
  },
  acknowledged: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model('Operation', operationSchema);
