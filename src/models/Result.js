const mongoose = require('mongoose');

const ResultSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: ['MATCHED', 'CONFLICTING', 'UNMATCHED_USER', 'UNMATCHED_EXCHANGE'],
    required: true,
    index: true
  },
  userTransaction: {
    type: Object,
    default: null
  },
  exchangeTransaction: {
    type: Object,
    default: null
  },
  reason: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Result', ResultSchema);
