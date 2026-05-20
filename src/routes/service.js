'use strict';

const express = require('express');
const { getSupportedAlgorithms } = require('../softBinding');

const router = express.Router();

// GET /services/supportedAlgorithms  — no auth required (public capability discovery)
router.get('/services/supportedAlgorithms', (req, res) => {
  try {
    return res.json(getSupportedAlgorithms());
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

module.exports = router;
