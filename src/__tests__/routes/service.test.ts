import express from 'express';
import request from 'supertest';
import { createServiceRouter } from '../../routes/service';
import { createSoftBindingRegistry } from '../../softBinding';

describe('GET /v1/services/supportedAlgorithms', () => {
  it('returns empty arrays when no extractors are registered', async () => {
    const app = express();
    app.use('/v1', createServiceRouter({ softBinding: createSoftBindingRegistry() }));

    const res = await request(app).get('/v1/services/supportedAlgorithms');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ watermarks: [], fingerprints: [] });
  });

  it('reflects registered extractors, categorized by name', async () => {
    const softBinding = createSoftBindingRegistry({
      'com.example.watermark.v1': async () => null,
      'com.example.fingerprint.v1': async () => null,
    });
    const app = express();
    app.use('/v1', createServiceRouter({ softBinding }));

    const res = await request(app).get('/v1/services/supportedAlgorithms');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      watermarks: [{ alg: 'com.example.watermark.v1' }],
      fingerprints: [{ alg: 'com.example.fingerprint.v1' }],
    });
  });
});
