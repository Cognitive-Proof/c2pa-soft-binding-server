import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createQueryRouter } from '../../routes/query';
import { createSoftBindingRegistry } from '../../softBinding';
import { createFakeDataStore } from '../helpers/fakeDataStore';

const allowAll: RequestHandler = (_req, _res, next) => next();

function buildApp(overrides: Partial<Parameters<typeof createQueryRouter>[0]> = {}) {
  const dataStore = overrides.dataStore ?? createFakeDataStore();
  const softBinding = overrides.softBinding ?? createSoftBindingRegistry();

  const app = express();
  app.use(express.json());
  app.use(
    '/v1',
    createQueryRouter({
      dataStore,
      softBinding,
      auth: allowAll,
      maxUploadSize: 1024 * 1024,
      maxReferenceSize: 1024 * 1024,
      ...overrides,
    }),
  );
  return { app, dataStore, softBinding };
}

describe('GET /v1/matches/byBinding', () => {
  it('returns 400 when value or alg is missing', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/v1/matches/byBinding?value=abc');

    expect(res.status).toBe(400);
  });

  it('returns 400 when maxResults is not a positive integer', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/v1/matches/byBinding?value=abc&alg=test&maxResults=0');

    expect(res.status).toBe(400);
  });

  it('returns matches for a known binding', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    await dataStore.createBinding('binding-1', manifestId);

    const res = await request(app).get('/v1/matches/byBinding?value=binding-1&alg=test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [{ manifestId, similarityScore: 1 }] });
  });

  it('returns an empty match list for an unknown binding', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/v1/matches/byBinding?value=unknown&alg=test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [] });
  });
});

describe('POST /v1/matches/byBinding', () => {
  it('returns 400 when the body is missing value or alg', async () => {
    const { app } = buildApp();

    const res = await request(app).post('/v1/matches/byBinding').send({ value: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns matches for a known binding', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    await dataStore.createBinding('binding-1', manifestId);

    const res = await request(app)
      .post('/v1/matches/byBinding')
      .send({ value: 'binding-1', alg: 'test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [{ manifestId, similarityScore: 1 }] });
  });
});

describe('POST /v1/matches/byContent', () => {
  it('returns 415 for an unsupported content type', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byContent')
      .set('Content-Type', 'unsupported/type')
      .send('data');

    expect(res.status).toBe(415);
  });

  it('returns 400 for an empty body', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byContent')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
  });

  it('returns empty matches when no extractor is registered for alg', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byContent?alg=com.example.watermark.v1')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('image-bytes'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [] });
  });

  it('uses the registered extractor and returns matches for the extracted binding', async () => {
    const softBinding = createSoftBindingRegistry({
      'com.example.watermark.v1': async () => 'binding-1',
    });
    const { app, dataStore } = buildApp({ softBinding });
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    await dataStore.createBinding('binding-1', manifestId);

    const res = await request(app)
      .post('/v1/matches/byContent?alg=com.example.watermark.v1')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('image-bytes'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [{ manifestId, similarityScore: 1 }] });
  });

  it('falls back to the caller-supplied hint when extraction returns nothing', async () => {
    const softBinding = createSoftBindingRegistry({
      'com.example.watermark.v1': async () => null,
    });
    const { app, dataStore } = buildApp({ softBinding });
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    await dataStore.createBinding('hinted-binding', manifestId);

    const res = await request(app)
      .post(
        '/v1/matches/byContent?alg=com.example.watermark.v1&hintAlg=com.example.fingerprint.v1&hintValue=hinted-binding',
      )
      .set('Content-Type', 'image/png')
      .send(Buffer.from('image-bytes'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [{ manifestId, similarityScore: 1 }] });
  });
});

describe('POST /v1/matches/byReference', () => {
  it('returns 400 when referenceUrl or assetLength is missing', async () => {
    const { app } = buildApp();

    const res = await request(app).post('/v1/matches/byReference').send({ referenceUrl: 'https://example.com/a.jpg' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-HTTPS referenceUrl', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'http://example.com/a.jpg', assetLength: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/HTTPS/);
  });

  it('returns 400 when assetLength exceeds maxReferenceSize', async () => {
    const { app } = buildApp({ maxReferenceSize: 10 });

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/a.jpg', assetLength: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds the server limit/);
  });
});
