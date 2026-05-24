const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Run = require('../models/Run');
const Transaction = require('../models/Transaction');
const Result = require('../models/Result');
const { parseCSV } = require('../services/parser');
const { runMatchingEngine } = require('../services/matcher');

/**
 * Triggers a reconciliation run using optional configuration overrides.
 * Uses local CSV files in the workspace as a default convenience fallback.
 */
const reconcile = async (req, res) => {
  try {
    const runId = uuidv4();

    // Read config settings from request body or fallback to env defaults (respecting KoinX exact spec names)
    const timestampToleranceSeconds = parseFloat(req.body.timestampToleranceSeconds) ||
      parseFloat(req.body.TIMESTAMP_TOLERANCE_SECONDS) ||
      parseFloat(process.env.TIMESTAMP_TOLERANCE_SECONDS) ||
      parseFloat(process.env.DEFAULT_TIMESTAMP_TOLERANCE_SECONDS) || 300;

    const quantityTolerancePct = parseFloat(req.body.quantityTolerancePct) ||
      parseFloat(req.body.QUANTITY_TOLERANCE_PCT) ||
      parseFloat(process.env.QUANTITY_TOLERANCE_PCT) ||
      parseFloat(process.env.DEFAULT_QUANTITY_TOLERANCE_PCT) || 0.01;

    // Local file paths in root workspace directory
    const defaultUserCSV = path.join(process.cwd(), 'user_transactions.csv');
    const defaultExchangeCSV = path.join(process.cwd(), 'exchange_transactions.csv');

    // Create the run track entry in MongoDB
    const runRecord = await Run.create({
      runId,
      status: 'PROCESSING',
      config: {
        timestampToleranceSeconds,
        quantityTolerancePct
      }
    });

    console.log(`[Run ${runId}] Starting ingestion and validation...`);

    // Ingest User Transactions CSV
    let userIngestSummary;
    try {
      userIngestSummary = await parseCSV(defaultUserCSV, 'user', runId);
    } catch (err) {
      runRecord.status = 'FAILED';
      runRecord.errorMessage = `User CSV ingestion failed: ${err.message}`;
      await runRecord.save();
      return res.status(400).json({ success: false, error: runRecord.errorMessage });
    }

    // Ingest Exchange Transactions CSV
    let exchangeIngestSummary;
    try {
      exchangeIngestSummary = await parseCSV(defaultExchangeCSV, 'exchange', runId);
    } catch (err) {
      runRecord.status = 'FAILED';
      runRecord.errorMessage = `Exchange CSV ingestion failed: ${err.message}`;
      await runRecord.save();
      return res.status(400).json({ success: false, error: runRecord.errorMessage });
    }

    console.log(`[Run ${runId}] Ingestion completed. Starting matching engine...`);

    // Run matching engine on ingested records
    const matchResults = await runMatchingEngine(runId, {
      timestampToleranceSeconds,
      quantityTolerancePct
    });

    // Compute metrics counts
    const matchedCount = matchResults.filter(r => r.category === 'MATCHED').length;
    const conflictingCount = matchResults.filter(r => r.category === 'CONFLICTING').length;
    const unmatchedUserCount = matchResults.filter(r => r.category === 'UNMATCHED_USER').length;
    const unmatchedExchangeCount = matchResults.filter(r => r.category === 'UNMATCHED_EXCHANGE').length;

    // Update the run logs with COMPLETED state and counts
    runRecord.status = 'COMPLETED';
    runRecord.summary = {
      matchedCount,
      conflictingCount,
      unmatchedUserCount,
      unmatchedExchangeCount,
      invalidUserRowsCount: userIngestSummary.invalidCount,
      invalidExchangeRowsCount: exchangeIngestSummary.invalidCount
    };
    await runRecord.save();

    console.log(`[Run ${runId}] Reconciliation run completed successfully!`);

    return res.status(200).json({
      success: true,
      runId,
      config: runRecord.config,
      summary: runRecord.summary
    });
  } catch (error) {
    console.error(`Reconciliation process crash: ${error.message}`);
    return res.status(500).json({ success: false, error: `Server error during reconciliation: ${error.message}` });
  }
};

/**
 * Fetches the full detailed report for a specific reconciliation run.
 * Supports pagination and category filtering.
 */
const getReport = async (req, res) => {
  try {
    const { runId } = req.params;
    const category = req.query.category; // Optional: MATCHED, CONFLICTING, UNMATCHED_USER, UNMATCHED_EXCHANGE
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const runRecord = await Run.findOne({ runId });
    if (!runRecord) {
      return res.status(404).json({ success: false, error: `Reconciliation run not found for ID: ${runId}` });
    }

    const query = { runId };
    if (category) {
      query.category = category.toUpperCase();
    }

    const results = await Result.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ category: 1 });

    const totalResults = await Result.countDocuments(query);

    return res.status(200).json({
      success: true,
      runId,
      status: runRecord.status,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalResults / limit),
        totalResults
      },
      results
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Fetches just the counts/summary of a reconciliation run.
 */
const getSummary = async (req, res) => {
  try {
    const { runId } = req.params;
    const runRecord = await Run.findOne({ runId });
    if (!runRecord) {
      return res.status(404).json({ success: false, error: `Reconciliation run not found for ID: ${runId}` });
    }

    return res.status(200).json({
      success: true,
      runId,
      status: runRecord.status,
      config: runRecord.config,
      summary: runRecord.summary
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Fetches only unmatched rows with their reasons for a specific reconciliation run.
 */
const getUnmatched = async (req, res) => {
  try {
    const { runId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const runRecord = await Run.findOne({ runId });
    if (!runRecord) {
      return res.status(404).json({ success: false, error: `Reconciliation run not found for ID: ${runId}` });
    }

    const query = {
      runId,
      category: { $in: ['UNMATCHED_USER', 'UNMATCHED_EXCHANGE'] }
    };

    const results = await Result.find(query)
      .skip(skip)
      .limit(limit);

    const totalResults = await Result.countDocuments(query);

    return res.status(200).json({
      success: true,
      runId,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalResults / limit),
        totalResults
      },
      results
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Downloads the full detailed report for a reconciliation run as a CSV file.
 */
const getReportCSV = async (req, res) => {
  try {
    const { runId } = req.params;
    const runRecord = await Run.findOne({ runId });
    if (!runRecord) {
      return res.status(404).json({ success: false, error: `Reconciliation run not found for ID: ${runId}` });
    }

    const results = await Result.find({ runId });

    // Define CSV Headers
    const headers = [
      'Category',
      'Reason',
      'User_Tx_ID',
      'User_Timestamp',
      'User_Type',
      'User_Asset',
      'User_Quantity',
      'User_Price_USD',
      'User_Fee',
      'User_Note',
      'Exchange_Tx_ID',
      'Exchange_Timestamp',
      'Exchange_Type',
      'Exchange_Asset',
      'Exchange_Quantity',
      'Exchange_Price_USD',
      'Exchange_Fee',
      'Exchange_Note'
    ];

    let csvContent = headers.join(',') + '\n';

    // Helper to sanitize CSV field to handle quotes, commas and newlines
    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const strVal = String(val);
      if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    };

    for (const r of results) {
      const u = r.userTransaction || {};
      const e = r.exchangeTransaction || {};

      const row = [
        r.category,
        r.reason,
        u.transactionId || '',
        u.rawTimestamp || '',
        u.type || '',
        u.asset || '',
        u.rawQuantity || '',
        u.priceUsd || '',
        u.fee || '',
        u.note || '',
        e.transactionId || '',
        e.rawTimestamp || '',
        e.type || '',
        e.asset || '',
        e.rawQuantity || '',
        e.priceUsd || '',
        e.fee || '',
        e.note || ''
      ];

      csvContent += row.map(escapeCSV).join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=reconciliation_report_${runId}.csv`);
    return res.status(200).send(csvContent);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  reconcile,
  getReport,
  getSummary,
  getUnmatched,
  getReportCSV
};
