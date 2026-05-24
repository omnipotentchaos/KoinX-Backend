const fs = require('fs');
const csv = require('csv-parser');
const Transaction = require('../models/Transaction');

/**
 * Parses a CSV file and inserts records into MongoDB.
 * @param {string} filePath - Path to the CSV file
 * @param {string} source - 'user' or 'exchange'
 * @param {string} runId - Unique UUID for this reconciliation run
 * @returns {Promise<Object>} Summary of ingestion (total, valid, invalid counts)
 */
const parseCSV = (filePath, source, runId) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    const results = [];
    let rowIndex = 0; // tracking CSV rows for exact reference
    let validCount = 0;
    let invalidCount = 0;

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowIndex++;
        const errors = [];

        // 1. Validate Transaction ID
        const txId = (row.transaction_id || row.transaction_Id || '').trim();
        if (!txId) {
          errors.push('Missing transaction_id');
        }

        // 2. Validate Timestamp
        const rawTime = (row.timestamp || '').trim();
        let parsedDate = null;
        if (!rawTime) {
          errors.push('Missing timestamp');
        } else {
          parsedDate = new Date(rawTime);
          if (isNaN(parsedDate.getTime())) {
            errors.push(`Malformed timestamp: "${rawTime}"`);
            parsedDate = null;
          }
        }

        // 3. Validate Transaction Type
        const rawType = (row.type || '').trim().toUpperCase();
        if (!rawType) {
          errors.push('Missing transaction type');
        }

        // 4. Validate Quantity
        const rawQty = (row.quantity || '').trim();
        let parsedQty = null;
        if (!rawQty) {
          errors.push('Missing quantity');
        } else {
          parsedQty = parseFloat(rawQty);
          if (isNaN(parsedQty)) {
            errors.push(`Malformed quantity: "${rawQty}"`);
            parsedQty = null;
          } else if (parsedQty <= 0) {
            errors.push(`Quantity must be greater than zero: "${rawQty}"`);
          }
        }

        // 5. Validate Asset and Normalize Aliases
        const rawAsset = (row.asset || '').trim();
        let normalizedAsset = rawAsset.toLowerCase();
        if (!rawAsset) {
          errors.push('Missing asset');
        } else {
          // Normalize common aliases
          if (normalizedAsset === 'bitcoin') {
            normalizedAsset = 'btc';
          } else if (normalizedAsset === 'ethereum') {
            normalizedAsset = 'eth';
          } else if (normalizedAsset === 'tether') {
            normalizedAsset = 'usdt';
          } else if (normalizedAsset === 'solana') {
            normalizedAsset = 'sol';
          } else if (normalizedAsset === 'polygon' || normalizedAsset === 'matic network') {
            normalizedAsset = 'matic';
          } else if (normalizedAsset === 'chainlink') {
            normalizedAsset = 'link';
          }
        }

        // 6. Parse price and fee safely
        const parsedPrice = parseFloat(row.price_usd || row.price || '0') || 0;
        const parsedFee = parseFloat(row.fee || '0') || 0;

        const isValid = errors.length === 0;
        if (isValid) {
          validCount++;
        } else {
          invalidCount++;
        }

        results.push({
          runId,
          source,
          rawRowIndex: rowIndex,
          transactionId: txId || `UNKNOWN-ROW-${rowIndex}`,
          timestamp: parsedDate,
          rawTimestamp: rawTime,
          type: (row.type || '').trim().toUpperCase(),
          asset: rawAsset,
          normalizedAsset,
          quantity: parsedQty,
          rawQuantity: rawQty,
          priceUsd: parsedPrice,
          fee: parsedFee,
          note: row.note || '',
          isValid,
          validationErrors: errors
        });
      })
      .on('end', async () => {
        try {
          if (results.length > 0) {
            await Transaction.insertMany(results);
          }
          resolve({
            totalRows: results.length,
            validCount,
            invalidCount
          });
        } catch (dbError) {
          reject(dbError);
        }
      })
      .on('error', (streamError) => {
        reject(streamError);
      });
  });
};

module.exports = {
  parseCSV
};
