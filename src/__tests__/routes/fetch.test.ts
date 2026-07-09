import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { AUTH_CONTEXT_LOCALS_KEY, AuthContext } from '../../auth';
import { createFetchRouter, FetchRouterDeps } from '../../routes/fetch';
import { buildReceipt as signReceipt } from '../../receipts';
import { createFakeDataStore } from '../helpers/fakeDataStore';

const allowAll: RequestHandler = (_req, _res, next) => next();
const RECEIPT_SECRET = 'test-secret';
const REPO_URI = 'https://repo.example.com';

function buildApp(overrides: Partial<FetchRouterDeps> = {}) {
  const dataStore = createFakeDataStore();
  const app = express();
  app.use(express.json());
  app.use(
    '/v1',
    createFetchRouter({
      dataStore,
      auth: allowAll,
      optionalAuth: allowAll,
      receiptSecret: RECEIPT_SECRET,
      ...overrides,
    }),
  );
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

  describe('with isManifestAuthRequired', () => {
    const authenticated: RequestHandler = (_req, res, next) => {
      res.locals[AUTH_CONTEXT_LOCALS_KEY] = {
        scopes: ['fetch:manifests'],
        claims: {},
      } satisfies AuthContext;
      next();
    };

    it('serves a manifest with no token when the predicate returns false', async () => {
      const { app, dataStore } = buildApp({
        optionalAuth: allowAll,
        isManifestAuthRequired: () => false,
      });
      const manifestId = await dataStore.addManifest(Buffer.from('public'), 'application/c2pa');

      const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}`);

      expect(res.status).toBe(200);
    });

    it('returns 404 (not 401/403) for a private manifest with no token', async () => {
      const { app, dataStore } = buildApp({
        optionalAuth: allowAll,
        isManifestAuthRequired: () => true,
      });
      const manifestId = await dataStore.addManifest(Buffer.from('private'), 'application/c2pa');

      const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}`);

      expect(res.status).toBe(404);
    });

    it('serves a private manifest when the caller has fetch:manifests scope', async () => {
      const { app, dataStore } = buildApp({
        optionalAuth: authenticated,
        isManifestAuthRequired: () => true,
      });
      const manifestId = await dataStore.addManifest(Buffer.from('private'), 'application/c2pa');

      const res = await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}`);

      expect(res.status).toBe(200);
    });

    it('passes the manifestId and AuthContext to the predicate', async () => {
      const isManifestAuthRequired = jest.fn().mockReturnValue(false);
      const { app, dataStore } = buildApp({ optionalAuth: authenticated, isManifestAuthRequired });
      const manifestId = await dataStore.addManifest(Buffer.from('public'), 'application/c2pa');

      await request(app).get(`/v1/manifests/${encodeURIComponent(manifestId)}`);

      expect(isManifestAuthRequired).toHaveBeenCalledWith(manifestId, {
        scopes: ['fetch:manifests'],
        claims: {},
      });
    });
  });

  describe('with manifestHtmlRedirect', () => {
    it('redirects a browser request (Accept: text/html) with 303 before auth or lookup runs', async () => {
      const manifestHtmlRedirect = jest.fn(
        (manifestId: string) => `https://viewer.example.com/${manifestId}`,
      );
      const { app } = buildApp({
        auth: (_req, res) => res.status(401).json({ error: 'nope' }),
        manifestHtmlRedirect,
      });

      const res = await request(app)
        .get('/v1/manifests/urn:c2pa:nonexistent')
        .set('Accept', 'text/html,application/xhtml+xml');

      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('https://viewer.example.com/urn:c2pa:nonexistent');
      expect(manifestHtmlRedirect).toHaveBeenCalledWith('urn:c2pa:nonexistent');
    });

    it('does not redirect a request without text/html in Accept', async () => {
      const { app, dataStore } = buildApp({
        manifestHtmlRedirect: (manifestId) => `https://viewer.example.com/${manifestId}`,
      });
      const manifestId = await dataStore.addManifest(Buffer.from('bytes'), 'application/c2pa');

      const res = await request(app)
        .get(`/v1/manifests/${encodeURIComponent(manifestId)}`)
        .set('Accept', 'application/c2pa');

      expect(res.status).toBe(200);
    });

    it('does not redirect when manifestHtmlRedirect is not configured', async () => {
      const { app, dataStore } = buildApp();
      const manifestId = await dataStore.addManifest(Buffer.from('bytes'), 'application/c2pa');

      const res = await request(app)
        .get(`/v1/manifests/${encodeURIComponent(manifestId)}`)
        .set('Accept', 'text/html');

      expect(res.status).toBe(200);
    });
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
