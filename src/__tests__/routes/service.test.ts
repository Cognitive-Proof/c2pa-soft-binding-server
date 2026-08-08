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

describe('GET /v1/services/capabilities', () => {
  it('returns the spec version and the static list of supported capabilities', async () => {
    const app = express();
    app.use('/v1', createServiceRouter({ softBinding: createSoftBindingRegistry() }));

    const res = await request(app).get('/v1/services/capabilities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      c2paSpecificationVersion: '2.4.0',
      supportedCapabilities: [
        'queryByContent',
        'queryByReference',
        'storeManifests',
        'storeBindings',
      ],
    });
  });
});

describe('GET /v1/services/status', () => {
  it('defaults to ok with a timestamp when no getServiceStatus hook is configured', async () => {
    const app = express();
    app.use('/v1', createServiceRouter({ softBinding: createSoftBindingRegistry() }));

    const res = await request(app).get('/v1/services/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('reflects the configured getServiceStatus hook', async () => {
    const app = express();
    app.use(
      '/v1',
      createServiceRouter({
        softBinding: createSoftBindingRegistry(),
        getServiceStatus: async () => ({ status: 'degraded' }),
      }),
    );

    const res = await request(app).get('/v1/services/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  it('reports down when the getServiceStatus hook throws', async () => {
    const app = express();
    app.use(
      '/v1',
      createServiceRouter({
        softBinding: createSoftBindingRegistry(),
        getServiceStatus: () => {
          throw new Error('db unreachable');
        },
      }),
    );

    const res = await request(app).get('/v1/services/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('down');
  });
});
