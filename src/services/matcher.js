const Transaction = require('../models/Transaction');
const Result = require('../models/Result');

/**
 * Executes the transaction matching algorithm between user and exchange transactions.
 * @param {string} runId - Unique UUID for this reconciliation run
 * @param {Object} config - Config tolerances
 * @param {number} config.timestampToleranceSeconds - Allowed time window discrepancy
 * @param {number} config.quantityTolerancePct - Allowed quantity variance percentage
 * @returns {Promise<Array>} The saved ReconciliationResult array
 */
const runMatchingEngine = async (runId, config) => {
  const { timestampToleranceSeconds, quantityTolerancePct } = config;

  // 1. Fetch valid transactions for this run
  const userTxs = await Transaction.find({ runId, source: 'user', isValid: true });
  const exchangeTxs = await Transaction.find({ runId, source: 'exchange', isValid: true });

  const results = [];
  const matchedExchangeIds = new Set();

  // 2. Loop through all valid User transactions
  for (const u of userTxs) {
    let bestMatchCandidate = null;
    let bestMatchCategory = null; // 'MATCHED' or 'CONFLICTING'
    let bestMatchReason = '';
    let smallestTimeDiff = Infinity;
    let smallestQtyDiffPct = Infinity;

    // Filter potential exchange candidates
    const candidates = exchangeTxs.filter((e) => {
      // Avoid matching already claimed exchange transactions
      if (matchedExchangeIds.has(e._id.toString())) return false;

      // Assets must match (we already normalized asset aliases at ingestion)
      if (u.normalizedAsset !== e.normalizedAsset) return false;

      // Map equivalent types
      if (u.type === 'TRANSFER_OUT') {
        return e.type === 'TRANSFER_IN';
      } else if (u.type === 'TRANSFER_IN') {
        return e.type === 'TRANSFER_OUT';
      } else {
        // BUY matches BUY, SELL matches SELL
        return u.type === e.type;
      }
    });

    // Evaluate candidates
    for (const e of candidates) {
      // Calculate Timestamp proximity in seconds
      const timeDiffSec = Math.abs(u.timestamp.getTime() - e.timestamp.getTime()) / 1000;

      // Must be within the timing window
      if (timeDiffSec > timestampToleranceSeconds) continue;

      // Calculate Quantity variance percentage
      const userQty = u.quantity;
      const exchQty = e.quantity;
      const qtyDiffAbs = Math.abs(userQty - exchQty);
      const qtyDiffPct = userQty > 0 ? (qtyDiffAbs / userQty) * 100 : 0;

      const isWithinQtyTolerance = qtyDiffPct <= quantityTolerancePct;

      if (isWithinQtyTolerance) {
        // Perfect Match scenario. Prioritize the closest match by time and quantity.
        if (timeDiffSec < smallestTimeDiff || (timeDiffSec === smallestTimeDiff && qtyDiffPct < smallestQtyDiffPct)) {
          bestMatchCandidate = e;
          bestMatchCategory = 'MATCHED';
          bestMatchReason = `Matched successfully (Time difference: ${timeDiffSec}s, Quantity difference: ${qtyDiffPct.toFixed(4)}%)`;
          smallestTimeDiff = timeDiffSec;
          smallestQtyDiffPct = qtyDiffPct;
        }
      } else {
        // Conflict scenario. Keep track of it in case we don't find a perfect MATCHED pair later.
        if (bestMatchCategory !== 'MATCHED') {
          if (timeDiffSec < smallestTimeDiff) {
            bestMatchCandidate = e;
            bestMatchCategory = 'CONFLICTING';
            bestMatchReason = `Close timestamp match, but quantity discrepancy of ${qtyDiffPct.toFixed(4)}% exceeds the ${quantityTolerancePct}% tolerance.`;
            smallestTimeDiff = timeDiffSec;
            smallestQtyDiffPct = qtyDiffPct;
          }
        }
      }
    }

    if (bestMatchCandidate) {
      results.push({
        runId,
        category: bestMatchCategory,
        userTransaction: u.toObject(),
        exchangeTransaction: bestMatchCandidate.toObject(),
        reason: bestMatchReason
      });
      // Lock this exchange transaction so it's not matched again
      matchedExchangeIds.add(bestMatchCandidate._id.toString());
    } else {
      // No match found in exchange transactions
      const assetLabel = (u.asset || u.normalizedAsset || 'N/A').toUpperCase();
      results.push({
        runId,
        category: 'UNMATCHED_USER',
        userTransaction: u.toObject(),
        exchangeTransaction: null,
        reason: `No matching exchange transaction found for asset ${assetLabel} with compatible type inside ±${timestampToleranceSeconds}s window.`
      });
    }
  }

  // 3. Find leftover unmatched exchange transactions
  for (const e of exchangeTxs) {
    if (!matchedExchangeIds.has(e._id.toString())) {
      const assetLabel = (e.asset || e.normalizedAsset || 'N/A').toUpperCase();
      results.push({
        runId,
        category: 'UNMATCHED_EXCHANGE',
        userTransaction: null,
        exchangeTransaction: e.toObject(),
        reason: `No matching user transaction found for asset ${assetLabel} with compatible type inside ±${timestampToleranceSeconds}s window.`
      });
    }
  }

  // 4. Save results to Database
  if (results.length > 0) {
    await Result.insertMany(results);
  }

  return results;
};

module.exports = {
  runMatchingEngine
};
