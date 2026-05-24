const { runMatchingEngine } = require('../services/matcher');
const Transaction = require('../models/Transaction');
const Result = require('../models/Result');

// Mock the Mongoose models to test in-isolation without requiring a running MongoDB service
jest.mock('../models/Transaction');
jest.mock('../models/Result');

describe('Reconciliation Engine - Core Matching Algorithm', () => {
  const mockRunId = 'test-run-123';
  const defaultConfig = {
    timestampToleranceSeconds: 300, // 5 minutes
    quantityTolerancePct: 0.01 // 0.01%
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should match transaction perfectly with exact timestamps and quantities', async () => {
    const userTx = {
      _id: 'user-id-1',
      toObject: () => ({ _id: 'user-id-1', source: 'user', asset: 'BTC', quantity: 0.5, timestamp: new Date('2024-03-01T09:00:00Z') }),
      source: 'user',
      isValid: true,
      normalizedAsset: 'btc',
      type: 'BUY',
      quantity: 0.5,
      timestamp: new Date('2024-03-01T09:00:00Z')
    };

    const exchangeTx = {
      _id: 'exchange-id-1',
      toObject: () => ({ _id: 'exchange-id-1', source: 'exchange', asset: 'BTC', quantity: 0.5, timestamp: new Date('2024-03-01T09:00:00Z') }),
      source: 'exchange',
      isValid: true,
      normalizedAsset: 'btc',
      type: 'BUY',
      quantity: 0.5,
      timestamp: new Date('2024-03-01T09:00:00Z')
    };

    // Mock DB queries
    Transaction.find.mockImplementation((query) => {
      if (query.source === 'user') return Promise.resolve([userTx]);
      if (query.source === 'exchange') return Promise.resolve([exchangeTx]);
      return Promise.resolve([]);
    });

    Result.insertMany.mockResolvedValue([]);

    const results = await runMatchingEngine(mockRunId, defaultConfig);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('MATCHED');
    expect(results[0].reason).toContain('Matched successfully');
    expect(results[0].userTransaction._id).toBe('user-id-1');
    expect(results[0].exchangeTransaction._id).toBe('exchange-id-1');
  });

  test('should pair TRANSFER_OUT on user side to TRANSFER_IN on exchange side', async () => {
    const userTx = {
      _id: 'user-id-2',
      toObject: () => ({ _id: 'user-id-2', source: 'user', asset: 'ETH', quantity: 1.0, type: 'TRANSFER_OUT', timestamp: new Date('2024-03-01T12:00:00Z') }),
      source: 'user',
      isValid: true,
      normalizedAsset: 'eth',
      type: 'TRANSFER_OUT',
      quantity: 1.0,
      timestamp: new Date('2024-03-01T12:00:00Z')
    };

    const exchangeTx = {
      _id: 'exchange-id-2',
      toObject: () => ({ _id: 'exchange-id-2', source: 'exchange', asset: 'ETH', quantity: 1.0, type: 'TRANSFER_IN', timestamp: new Date('2024-03-01T12:00:00Z') }),
      source: 'exchange',
      isValid: true,
      normalizedAsset: 'eth',
      type: 'TRANSFER_IN',
      quantity: 1.0,
      timestamp: new Date('2024-03-01T12:00:00Z')
    };

    Transaction.find.mockImplementation((query) => {
      if (query.source === 'user') return Promise.resolve([userTx]);
      if (query.source === 'exchange') return Promise.resolve([exchangeTx]);
      return Promise.resolve([]);
    });

    const results = await runMatchingEngine(mockRunId, defaultConfig);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('MATCHED');
    expect(results[0].userTransaction._id).toBe('user-id-2');
    expect(results[0].exchangeTransaction._id).toBe('exchange-id-2');
  });

  test('should mark CONFLICTING if match is within timestamp window but quantity differs beyond tolerance', async () => {
    const userTx = {
      _id: 'user-id-3',
      toObject: () => ({ _id: 'user-id-3', source: 'user', asset: 'SOL', quantity: 10.0, type: 'BUY', timestamp: new Date('2024-03-01T15:00:00Z') }),
      source: 'user',
      isValid: true,
      normalizedAsset: 'sol',
      type: 'BUY',
      quantity: 10.0,
      timestamp: new Date('2024-03-01T15:00:00Z')
    };

    // Exchange reports 10.1 SOL (1% difference, exceeds 0.01% default tolerance)
    const exchangeTx = {
      _id: 'exchange-id-3',
      toObject: () => ({ _id: 'exchange-id-3', source: 'exchange', asset: 'SOL', quantity: 10.1, type: 'BUY', timestamp: new Date('2024-03-01T15:00:05Z') }),
      source: 'exchange',
      isValid: true,
      normalizedAsset: 'sol',
      type: 'BUY',
      quantity: 10.1,
      timestamp: new Date('2024-03-01T15:00:05Z')
    };

    Transaction.find.mockImplementation((query) => {
      if (query.source === 'user') return Promise.resolve([userTx]);
      if (query.source === 'exchange') return Promise.resolve([exchangeTx]);
      return Promise.resolve([]);
    });

    const results = await runMatchingEngine(mockRunId, defaultConfig);

    const conflictingMatch = results.find(r => r.category === 'CONFLICTING');
    expect(conflictingMatch).toBeDefined();
    expect(conflictingMatch.reason).toContain('exceeds the 0.01% tolerance');
  });

  test('should mark as UNMATCHED if outside of timestamp tolerance window', async () => {
    const userTx = {
      _id: 'user-id-4',
      toObject: () => ({ _id: 'user-id-4', source: 'user', asset: 'LINK', quantity: 5.0, type: 'BUY', timestamp: new Date('2024-03-01T09:00:00Z') }),
      source: 'user',
      isValid: true,
      normalizedAsset: 'link',
      type: 'BUY',
      quantity: 5.0,
      timestamp: new Date('2024-03-01T09:00:00Z')
    };

    // Exchange reports same asset and qty but 10 minutes later (600s, exceeds 300s window)
    const exchangeTx = {
      _id: 'exchange-id-4',
      toObject: () => ({ _id: 'exchange-id-4', source: 'exchange', asset: 'LINK', quantity: 5.0, type: 'BUY', timestamp: new Date('2024-03-01T09:10:00Z') }),
      source: 'exchange',
      isValid: true,
      normalizedAsset: 'link',
      type: 'BUY',
      quantity: 5.0,
      timestamp: new Date('2024-03-01T09:10:00Z')
    };

    Transaction.find.mockImplementation((query) => {
      if (query.source === 'user') return Promise.resolve([userTx]);
      if (query.source === 'exchange') return Promise.resolve([exchangeTx]);
      return Promise.resolve([]);
    });

    const results = await runMatchingEngine(mockRunId, defaultConfig);

    const unmatchedUser = results.find(r => r.category === 'UNMATCHED_USER');
    const unmatchedExchange = results.find(r => r.category === 'UNMATCHED_EXCHANGE');

    expect(unmatchedUser).toBeDefined();
    expect(unmatchedExchange).toBeDefined();
    expect(unmatchedUser.reason).toContain('No matching exchange transaction found');
  });
});
