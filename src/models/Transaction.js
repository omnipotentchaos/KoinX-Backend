const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    index: true
  },
  source: {
    type: String,
    enum: ['user', 'exchange'],
    required: true
  },
  rawRowIndex: {
    type: Number,
    required: true
  },
  transactionId: {
    type: String
  },
  timestamp: {
    type: Date,
    default: null
  },
  rawTimestamp: {
    type: String
  },
  type: {
    type: String
  },
  asset: {
    type: String
  },
  normalizedAsset: {
    type: String,
    index: true
  },
  quantity: {
    type: Number,
    default: null
  },
  rawQuantity: {
    type: String
  },
  priceUsd: {
    type: Number,
    default: 0
  },
  fee: {
    type: Number,
    default: 0
  },
  note: {
    type: String,
    default: ''
  },
  isValid: {
    type: Boolean,
    default: true
  },
  validationErrors: {
    type: [String],
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transaction', TransactionSchema);
