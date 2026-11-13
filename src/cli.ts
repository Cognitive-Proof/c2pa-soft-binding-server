#!/usr/bin/env node
import 'dotenv/config';
import type { RequestHandler } from 'express';
import { createServer } from './index';

// Opt-in Google service-account auth: SA_AUTH_ACCOUNTS (+ SA_AUTH_AUDIENCE)
// wires in the separately installed google-service-account-auth plugin.
function serviceAccountAuthFromEnv(): RequestHandler | undefined {
  if (!process.env.SA_AUTH_ACCOUNTS) return undefined;

  const plugin = require('@cognitiveproof/softbinding-api-plugin-google-service-account-auth') as {
    default: (options: unknown) => RequestHandler;
    serviceAccountAuthOptionsFromEnv: () => unknown;
  };
  return plugin.default(plugin.serviceAccountAuthOptionsFromEnv());
}

const port = parseInt(process.env.PORT ?? '3000', 10);
const app = createServer({ auth: serviceAccountAuthFromEnv() });

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
  console.log('Original text routes (when an object store is configured):');
  console.log('  PUT    /v1/originals/:manifestId');
  console.log('  GET    /v1/originals/:manifestId');
  console.log('  DELETE /v1/originals/:manifestId');
  console.log('');
  console.log('Service routes:');
  console.log('  GET  /v1/services/supportedAlgorithms');
  console.log('  GET  /v1/services/capabilities');
  console.log('  GET  /v1/services/status');
  console.log('  GET  /.well-known/c2pa-soft-binding-resolution');
  console.log('');
  console.log('Docs:');
  console.log('  GET  /docs');
  console.log('  GET  /v1/openapi.json');
});
