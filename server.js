'use strict';

require('dotenv').config();

const express = require('express');
const { PORT } = require('./src/config');

// Plug in your watermark / fingerprint extractors here before starting the server.
// Example:
//   const { registerExtractor } = require('./src/softBinding');
//   registerExtractor('com.example.watermark.v1', async (buffer, mimeType) => { ... });

const app = express();

// Global JSON body parser — individual routes add their own raw parsers as needed
app.use(express.json());

app.use('/v1', require('./src/routes/query'));
app.use('/v1', require('./src/routes/store'));
app.use('/v1', require('./src/routes/fetch'));
app.use('/v1', require('./src/routes/service'));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`C2PA Soft Binding Resolution API listening on http://localhost:${PORT}/v1`);
    console.log('');
    console.log('Query routes:');
    console.log('  GET  /v1/matches/byBinding');
    console.log('  POST /v1/matches/byBinding');
    console.log('  POST /v1/matches/byContent');
    console.log('  POST /v1/matches/byReference');
    console.log('');
    console.log('Store routes:');
    console.log('  POST   /v1/manifests');
    console.log('  POST   /v1/bindings');
    console.log('  PUT    /v1/bindings');
    console.log('  DELETE /v1/manifests/:manifestId');
    console.log('');
    console.log('Fetch routes:');
    console.log('  GET  /v1/manifests/:manifestId');
    console.log('  GET  /v1/manifests/:manifestId/receipts');
    console.log('  POST /v1/manifests/:manifestId/receipts');
    console.log('');
    console.log('Service routes:');
    console.log('  GET  /v1/services/supportedAlgorithms');
  });
}

module.exports = app;
