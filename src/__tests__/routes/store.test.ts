import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createStoreRouter } from '../../routes/store';
import { createFakeDataStore } from '../helpers/fakeDataStore';

const allowAll: RequestHandler = (_req, _res, next) => next();

function buildApp() {
  const dataStore = createFakeDataStore();
  const app = express();
  app.use(express.json());
  app.use(
    '/v1',
    createStoreRouter({
      dataStore,
      auth: allowAll,
      repoUri: 'https://repo.example.com',
      receiptSecret: 'test-secret',
    }),
  );
  return { app, dataStore };
}

describe('POST /v1/manifests', () => {
  it('returns 400 for an empty body', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
  });

  it('stores the manifest and returns its id', async () => {
    const { app, dataStore } = buildApp();

    const res = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(Buffer.from('manifest-bytes'));

    expect(res.status).toBe(200);
    expect(res.body.manifestId).toEqual(expect.any(String));
    expect(res.body.receipt).toBeUndefined();

    const stored = await dataStore.getManifest(res.body.manifestId);
    expect(stored?.data).toEqual(Buffer.from('manifest-bytes'));
  });

  it('returns a receipt when returnReceipt=true', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/manifests?returnReceipt=true')
      .set('Content-Type', 'application/c2pa')
      .send(Buffer.from('manifest-bytes'));

    expect(res.status).toBe(200);
    expect(res.body.receipt).toMatchObject({
      '@type': 'org.c2pa.manifest-receipt',
      repository: { uri: 'https://repo.example.com', manifestId: res.body.manifestId },
    });
    expect(res.body.receipt.anchor.proof.alg).toBe('HMAC-SHA256');
  });
});

describe('POST /v1/bindings', () => {
  it('returns 400 when bindingValue or manifestId is missing', async () => {
    const { app } = buildApp();

    const res = await request(app).post('/v1/bindings').send({ bindingValue: 'b1' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the manifest does not exist', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/bindings')
      .send({ bindingValue: 'b1', manifestId: 'urn:c2pa:nonexistent' });

    expect(res.status).toBe(404);
  });

  it('creates the binding and returns 204', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');

    const res = await request(app).post('/v1/bindings').send({ bindingValue: 'b1', manifestId });

    expect(res.status).toBe(204);
    expect(await dataStore.findByBinding('b1')).toEqual([{ manifestId, similarityScore: 1 }]);
  });
});

describe('PUT /v1/bindings', () => {
  it('returns 404 when the binding does not exist', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .put('/v1/bindings')
      .send({ bindingValue: 'unknown', manifestId: 'urn:c2pa:1' });

    expect(res.status).toBe(404);
  });

  it('updates an existing binding and returns 204', async () => {
    const { app, dataStore } = buildApp();
    const manifestId1 = await dataStore.addManifest(Buffer.from('m1'), 'application/c2pa');
    const manifestId2 = await dataStore.addManifest(Buffer.from('m2'), 'application/c2pa');
    await dataStore.createBinding('b1', manifestId1);

    const res = await request(app)
      .put('/v1/bindings')
      .send({ bindingValue: 'b1', manifestId: manifestId2 });

    expect(res.status).toBe(204);
    expect(await dataStore.findByBinding('b1')).toEqual([
      { manifestId: manifestId2, similarityScore: 1 },
    ]);
  });
});

describe('DELETE /v1/manifests/:manifestId', () => {
  it('returns 404 when the manifest does not exist', async () => {
    const { app } = buildApp();

    const res = await request(app).delete('/v1/manifests/urn:c2pa:nonexistent');

    expect(res.status).toBe(404);
  });

  it('deletes the manifest and returns 204', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');

    const res = await request(app).delete(`/v1/manifests/${encodeURIComponent(manifestId)}`);

    expect(res.status).toBe(204);
    expect(await dataStore.manifestExists(manifestId)).toBe(false);
  });
});
