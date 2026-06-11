#!/usr/bin/env node
import 'dotenv/config';
import { createServer } from './index';

const port = parseInt(process.env.PORT ?? '3000', 10);
const app = createServer();

app.listen(port, () => {
  console.log(`C2PA Soft Binding Resolution API listening on http://localhost:${port}/v1`);
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
  console.log('');
  console.log('Docs:');
  console.log('  GET  /docs');
  console.log('  GET  /v1/openapi.json');
});
