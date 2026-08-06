import type { RequestHandler } from 'express';
import request from 'supertest';
import { createServer } from '../index';
import { createFakeDataStore } from './helpers/fakeDataStore';
import type { Logger } from '@cognitiveproof/softbinding-api-plugin-types';

const allowAll: RequestHandler = (_req, _res, next) => next();

describe('createServer', () => {
  it('responds to the health check', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false });

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toBe('C2PA-Softbinding-Server - Healthy');
  });

  it('returns 404 for unknown routes', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false });

    const res = await request(app).get('/no-such-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('mounts /docs and /v1/openapi.json by default', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll });

    const openapi = await request(app).get('/v1/openapi.json');
    expect(openapi.status).toBe(200);
    expect(openapi.body).toHaveProperty('openapi');

    const docs = await request(app).get('/docs');
    expect([200, 301]).toContain(docs.status);
  });

  it('does not mount /docs or /v1/openapi.json when docs is false', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false });

    const openapi = await request(app).get('/v1/openapi.json');
    expect(openapi.status).toBe(404);
  });

  it('applies the auth middleware to /v1 routes', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: (_req, res) => res.status(401).json({ error: 'nope' }),
      docs: false,
    });

    const res = await request(app).get('/v1/matches/byBinding?value=abc&alg=test');

    expect(res.status).toBe(401);
  });

  it('enforces the scope published by auth middleware before route handlers run', async () => {
    const dataStore = createFakeDataStore();
    const createBinding = jest.spyOn(dataStore, 'createBinding');
    const app = createServer({
      dataStore,
      auth: (_req, res, next) => {
        res.locals.c2paAuthScopes = ['fetch:manifests'];
        next();
      },
      docs: false,
    });

    const fetchRes = await request(app).get('/v1/matches/byBinding?value=abc&alg=test');
    const storeRes = await request(app)
      .post('/v1/bindings')
      .send({ bindingValue: 'abc', manifestId: 'manifest-id' });

    expect(fetchRes.status).toBe(200);
    expect(storeRes.status).toBe(403);
    expect(storeRes.body).toEqual({ error: 'Missing required scope: store:bindings' });
    expect(createBinding).not.toHaveBeenCalled();
  });

  it('returns 413 when a JSON request exceeds maxJsonSize', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      maxJsonSize: 32,
    });

    const res = await request(app)
      .post('/v1/matches/byBinding')
      .send({ value: 'x'.repeat(100), alg: 'test' });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body exceeds the configured size limit' });
  });

  it('returns 413 when a raw asset exceeds maxUploadSize', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      maxUploadSize: 4,
    });

    const res = await request(app)
      .post('/v1/matches/byContent')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('too-large'));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body exceeds the configured size limit' });
  });

  it('returns 400 for malformed JSON', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
    });

    const res = await request(app)
      .post('/v1/matches/byBinding')
      .set('Content-Type', 'application/json')
      .send('{"value":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Malformed JSON request body' });
  });

  it('applies helmet security headers by default', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false });

    const res = await request(app).get('/');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not apply helmet headers when helmet is false', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      helmet: false,
    });

    const res = await request(app).get('/');

    expect(res.headers['x-content-type-options']).toBeUndefined();
    expect(res.headers['x-dns-prefetch-control']).toBeUndefined();
  });

  it('rate limits /v1 routes and returns 429 once the limit is exceeded', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      rateLimit: { windowMs: 60_000, limit: 2 },
    });

    await request(app).get('/v1/services/supportedAlgorithms');
    await request(app).get('/v1/services/supportedAlgorithms');
    const res = await request(app).get('/v1/services/supportedAlgorithms');

    expect(res.status).toBe(429);
  });

  it('does not rate limit / when rateLimit is set', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      rateLimit: { windowMs: 60_000, limit: 1 },
    });

    await request(app).get('/');
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });

  it('does not rate limit when rateLimit is false', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      rateLimit: false,
    });

    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/v1/services/supportedAlgorithms');
      expect(res.status).toBe(200);
    }
  });

  it('logs each request via the configured logger', async () => {
    const logger: Logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    };
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      logger,
    });

    await request(app).get('/');

    expect(logger.info).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({ method: 'GET', path: '/', status: 200 }),
    );
  });

  it('serves the well-known discovery document without auth, outside /v1', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: (_req, res) => res.status(401).json({ error: 'nope' }),
      docs: false,
    });

    const res = await request(app).get('/.well-known/c2pa-soft-binding-resolution');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      apiEndpoint: '/v1',
      c2paSpecificationVersion: '2.4.0',
      capabilitiesEndpoint: '/v1/services/capabilities',
      statusEndpoint: '/v1/services/status',
    });
  });

  it('does not require auth for /v1/services/supportedAlgorithms', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: (_req, res) => res.status(401).json({ error: 'nope' }),
      docs: false,
      extractors: { 'com.example.watermark.v1': async () => null },
    });

    const res = await request(app).get('/v1/services/supportedAlgorithms');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      watermarks: [{ alg: 'com.example.watermark.v1' }],
      fingerprints: [],
    });
  });
});
