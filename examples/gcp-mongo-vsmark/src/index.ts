import 'dotenv/config';
import { createServer, loadObjectStore } from '@cognitiveproof/softbinding-api-server';
import { vsmarkExtractor, VSMARK_ALGORITHM } from '@cognitiveproof/softbinding-api-plugin-vsmark';
import express, { Request, Response } from 'express';

// Manifests, soft bindings, and receipts are persisted in MongoDB.
// Binary assets (e.g. watermarked copies) are persisted in Google Cloud Storage.
// Auth defaults to Google Identity Platform (gcpProjectId), logging to pino.
const app = createServer({
  dataStore: '@cognitiveproof/softbinding-api-plugin-mongodb',
  logger: '@cognitiveproof/softbinding-api-plugin-pino-logger',
  gcpProjectId: process.env.GCP_PROJECT_ID,
  extractors: {
    [VSMARK_ALGORITHM]: vsmarkExtractor,
  },
});

// loadObjectStore() isn't wired into the bundled /v1 routes, but is available
// for custom routes that need to read/write blobs (e.g. serving a watermarked
// copy of an asset alongside its manifest).
const objectStore = loadObjectStore('@cognitiveproof/softbinding-api-plugin-gcp-bucket');

app.get('/v1/assets/:key/url', async (req: Request, res: Response) => {

  if (Array.isArray(req.params.key)) {
    res.status(400).json({ error: 'Invalid asset key' });
    return;
  }
  const url = await objectStore.getPublicUrl(req.params.key);

  if (!url) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  res.json({ url });
});

const port = parseInt(process.env.PORT ?? '3000', 10);
app.listen(port, () => {
  console.log(`C2PA Soft Binding Resolution API listening on http://localhost:${port}/v1`);
});
