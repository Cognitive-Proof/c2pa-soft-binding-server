import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createFetchRouter } from '../../routes/fetch';
import { buildReceipt as signReceipt } from '../../receipts';
import { createFakeDataStore } from '../helpers/fakeDataStore';

const allowAll: RequestHandler = (_req, _res, next) => next();
const RECEIPT_SECRET = 'test-secret';
const REPO_URI = 'https://repo.example.com';

function buildApp() {
  const dataStore = createFakeDataStore();
  const app = express();
  app.use(express.json());
  app.use('/v1', createFetchRouter({ dataStore, auth: allowAll, receiptSecret: RECEIPT_SECRET }));
  return { app, dataStore };
}

function buildReceipt(manifestId: string, secret = RECEIPT_SECRET) {
  return signReceipt(manifestId, REPO_URI, secret);
}

describe('GET /v1/manifests/:manifestId', () => {
  it('returns 404 for an unknown manifest', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/v1/manifests/urn:c2pa:nonexistent');

    expect(res.status).toBe(404);
  });

  it('returns the manifest data with the application/c2pa content type', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(
      Buffer.from('manifest-bytes'),
      'application/c2pa',
    );

    const res = await request(app)
      .get(`/v1/manifests/${encodeURIComponent(manifestId)}`)
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/c2pa/);
    expect(res.body).toEqual(Buffer.from('manifest-bytes'));
  });
});

describe('GET /v1/manifests/:manifestId/receipts', () => {
  it('returns 404 when the manifest does not exist', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/v1/manifests/urn:c2pa:nonexistent/receipts');

    expect(res.status).toBe(404);
  });

  it('returns 404 when the manifest has no receipt', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');

    const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`);

    expect(res.status).toBe(404);
  });

  it('returns the receipt with verified=true for a valid proof', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    await dataStore.setReceipt(manifestId, buildReceipt(manifestId));

    const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('returns the receipt with verified=false for a tampered proof', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    const receipt = buildReceipt(manifestId, 'wrong-secret');
    await dataStore.setReceipt(manifestId, receipt);

    const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it('returns the receipt with verified=false when repository.uri has been tampered with', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    const receipt = buildReceipt(manifestId);
    receipt.repository.uri = 'https://attacker.example.com';
    await dataStore.setReceipt(manifestId, receipt);

    const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it('returns the receipt with verified=false when anchor.proof.alg has been tampered with', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    const receipt = buildReceipt(manifestId);
    receipt.anchor.proof.alg = 'none';
    await dataStore.setReceipt(manifestId, receipt);

    const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });
});

describe('POST /v1/manifests/:manifestId/receipts', () => {
  it('returns 400 for a receipt with the wrong @type', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');

    const res = await request(app)
      .post(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`)
      .send({ '@type': 'something.else' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the manifest does not exist', async () => {
    const { app } = buildApp();
    const receipt = buildReceipt('urn:c2pa:nonexistent');

    const res = await request(app)
      .post('/v1/manifests/urn:c2pa:nonexistent/receipts')
      .send(receipt);

    expect(res.status).toBe(404);
  });

  it('returns verified=true for a valid receipt matching the manifestId', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    const receipt = buildReceipt(manifestId);

    const res = await request(app)
      .post(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`)
      .send(receipt);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('returns 400 when the receipt manifestId does not match the URL', async () => {
    const { app, dataStore } = buildApp();
    const manifestId = await dataStore.addManifest(Buffer.from('manifest'), 'application/c2pa');
    const receipt = buildReceipt('urn:c2pa:other');

    const res = await request(app)
      .post(`/v1/manifests/${encodeURIComponent(manifestId)}/receipts`)
      .send(receipt);

    expect(res.status).toBe(400);
    expect(res.body.verified).toBe(false);
  });
});
