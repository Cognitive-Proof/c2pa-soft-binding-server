import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { PORT } from './config';

// Plug in your watermark / fingerprint extractors here before starting the server.
// Example:
//   import { registerExtractor } from './softBinding';
//   registerExtractor('com.example.watermark.v1', async (buffer, mimeType) => { ... });

import queryRouter from './routes/query';
import storeRouter from './routes/store';
import fetchRouter from './routes/fetch';
import serviceRouter from './routes/service';

const app = express();

// Global JSON body parser — individual routes add their own raw parsers as needed
app.use(express.json());

app.get('/', (_req, res) => res.send('C2PA-Softbinding-Server - Healthy'));

app.use('/v1', queryRouter);
app.use('/v1', storeRouter);
app.use('/v1', fetchRouter);
app.use('/v1', serviceRouter);

app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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

export default app;
