const express = require('express');
const router = express.Router();
const {
  reconcile,
  getReport,
  getSummary,
  getUnmatched,
  getReportCSV
} = require('../controllers/reconcileController');

// Trigger a new reconciliation run
router.post('/reconcile', reconcile);

// Fetch full report for a specific run ID
router.get('/report/:runId', getReport);

// Fetch CSV formatted report file for a specific run ID
router.get('/report/:runId/csv', getReportCSV);

// Fetch summary metrics for a specific run ID
router.get('/report/:runId/summary', getSummary);

// Fetch only unmatched records and reasons for a specific run ID
router.get('/report/:runId/unmatched', getUnmatched);

module.exports = router;
