const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();

// Set up CORS
app.use(cors());

// Configure body-parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// Map reconciliation API routes (both at root for strict spec compliance, and /api for dashboard compatibility)
app.use('/', apiRoutes);
app.use('/api', apiRoutes);

// Serve the visual dashboard landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`Unhandled Error: ${err.message}`);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

module.exports = app;
