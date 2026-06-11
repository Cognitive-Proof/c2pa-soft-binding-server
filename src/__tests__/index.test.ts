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

  it('applies helmet security headers by default', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false });

    const res = await request(app).get('/');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not apply helmet headers when helmet is false', async () => {
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false, helmet: false });

    const res = await request(app).get('/');

    expect(res.headers['x-content-type-options']).toBeUndefined();
    expect(res.headers['x-dns-prefetch-control']).toBeUndefined();
  });

  it('logs each request via the configured logger', async () => {
    const logger: Logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    };
    const app = createServer({ dataStore: createFakeDataStore(), auth: allowAll, docs: false, logger });

    await request(app).get('/');

    expect(logger.info).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({ method: 'GET', path: '/', status: 200 }),
    );
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
    expect(res.body).toEqual({ watermarks: [{ alg: 'com.example.watermark.v1' }], fingerprints: [] });
  });
});
