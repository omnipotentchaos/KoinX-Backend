const mongoose = require('mongoose');

const RunSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PROCESSING'
  },
  config: {
    timestampToleranceSeconds: {
      type: Number,
      required: true
    },
    quantityTolerancePct: {
      type: Number,
      required: true
    }
  },
  summary: {
    matchedCount: { type: Number, default: 0 },
    conflictingCount: { type: Number, default: 0 },
    unmatchedUserCount: { type: Number, default: 0 },
    unmatchedExchangeCount: { type: Number, default: 0 },
    invalidUserRowsCount: { type: Number, default: 0 },
    invalidExchangeRowsCount: { type: Number, default: 0 }
  },
  errorMessage: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Run', RunSchema);
