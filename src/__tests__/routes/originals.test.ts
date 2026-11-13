import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createOriginalsRouter } from '../../routes/originals';
import { AUTH_SCOPES_LOCALS_KEY } from '../../auth';
import { createServer } from '../../index';
import { createFakeDataStore } from '../helpers/fakeDataStore';
import { createFakeObjectStore } from '../helpers/fakeObjectStore';

const allowAll: RequestHandler = (_req, _res, next) => next();
const MANIFEST_ID = 'urn:c2pa:3fa85f64-5717-4562-b3fc-2c963f66afa6';
const KEY = `originals/${encodeURIComponent(MANIFEST_ID)}`;

function buildApp(overrides: Partial<Parameters<typeof createOriginalsRouter>[0]> = {}) {
  const originalsStore = createFakeObjectStore();
  const app = express();
  app.use(express.json());
  app.use(
    '/v1',
    createOriginalsRouter({
      originalsStore,
      auth: allowAll,
      maxOriginalSize: 1024,
      ...overrides,
    }),
  );
  return { app, originalsStore };
}

describe('PUT /v1/originals/:manifestId', () => {
  it('stores the exact bytes with a normalized content type', async () => {
    const { app, originalsStore } = buildApp();
    // A leading BOM must survive: verifiers hash the stored bytes.
    const body = Buffer.from('﻿# Title\n\nSigned text ✓', 'utf8');

    const res = await request(app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/markdown; charset=UTF-8')
      .send(body);

    expect(res.status).toBe(204);
    expect(originalsStore.objects.get(KEY)).toEqual({
      buffer: body,
      contentType: 'text/markdown; charset=utf-8',
    });
  });

  it('overwrites on retry', async () => {
    const { app, originalsStore } = buildApp();
    const put = () =>
      request(app)
        .put(`/v1/originals/${MANIFEST_ID}`)
        .set('Content-Type', 'text/plain')
        .send('same text');

    expect((await put()).status).toBe(204);
    expect((await put()).status).toBe(204);
    expect(originalsStore.objects.get(KEY)?.buffer.toString()).toBe('same text');
  });

  it.each(['not-a-urn', 'urn:c2pa:..%2F..%2Fetc', 'urn:c2pa:3fa85f64'])(
    'returns 400 for the invalid id %s',
    async (id) => {
      const { app } = buildApp();

      const res = await request(app)
        .put(`/v1/originals/${id}`)
        .set('Content-Type', 'text/plain')
        .send('text');

      expect(res.status).toBe(400);
    },
  );

  it('returns 400 for an empty body', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/plain')
      .send('');

    expect(res.status).toBe(400);
  });

  it.each(['text/html', 'application/octet-stream', 'text/plain; charset=iso-8859-1'])(
    'returns 415 for Content-Type %s',
    async (contentType) => {
      const { app } = buildApp();

      const res = await request(app)
        .put(`/v1/originals/${MANIFEST_ID}`)
        .set('Content-Type', contentType)
        .send('text');

      expect(res.status).toBe(415);
    },
  );

  it('returns 413 when the body exceeds maxOriginalSize', async () => {
    const { app } = buildApp({ maxOriginalSize: 10 });

    const res = await request(app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/plain')
      .send('x'.repeat(11));

    expect(res.status).toBe(413);
  });

  it('requires the store:originals scope', async () => {
    const withScopes =
      (scopes: string[]): RequestHandler =>
      (_req, res, next) => {
        res.locals[AUTH_SCOPES_LOCALS_KEY] = scopes;
        next();
      };

    const denied = buildApp({ auth: withScopes(['store:manifests']) });
    const res = await request(denied.app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/plain')
      .send('text');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Missing required scope: store:originals' });

    const allowed = buildApp({ auth: withScopes(['store:originals']) });
    const ok = await request(allowed.app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/plain')
      .send('text');
    expect(ok.status).toBe(204);
  });

  it('returns 500 when the store fails', async () => {
    const originalsStore = createFakeObjectStore();
    originalsStore.saveData = () => Promise.reject(new Error('boom'));
    const { app } = buildApp({ originalsStore });

    const res = await request(app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/plain')
      .send('text');

    expect(res.status).toBe(500);
  });
});

describe('GET /v1/originals/:manifestId', () => {
  it('returns the stored bytes publicly, even when auth would reject', async () => {
    const reject: RequestHandler = (_req, res) => {
      res.status(401).json({ error: 'Authorization required' });
    };
    const { app, originalsStore } = buildApp({ auth: reject });
    originalsStore.objects.set(KEY, {
      buffer: Buffer.from('# Hello'),
      contentType: 'text/markdown; charset=utf-8',
    });

    const res = await request(app).get(`/v1/originals/${MANIFEST_ID}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('# Hello');
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('never serves a non-text content type', async () => {
    const { app, originalsStore } = buildApp();
    originalsStore.objects.set(KEY, { buffer: Buffer.from('<b>x</b>'), contentType: 'text/html' });

    const res = await request(app).get(`/v1/originals/${MANIFEST_ID}`);

    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('returns 404 when nothing is stored', async () => {
    const { app } = buildApp();

    const res = await request(app).get(`/v1/originals/${MANIFEST_ID}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/v1/originals/nope');

    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/originals/:manifestId', () => {
  it('deletes a stored original', async () => {
    const { app, originalsStore } = buildApp();
    originalsStore.objects.set(KEY, { buffer: Buffer.from('x'), contentType: 'text/plain' });

    const res = await request(app).delete(`/v1/originals/${MANIFEST_ID}`);

    expect(res.status).toBe(204);
    expect(originalsStore.objects.has(KEY)).toBe(false);
  });

  it('returns 404 when nothing is stored', async () => {
    const { app } = buildApp();

    const res = await request(app).delete(`/v1/originals/${MANIFEST_ID}`);

    expect(res.status).toBe(404);
  });
});

describe('createServer originalsStore option', () => {
  const baseOptions = { dataStore: createFakeDataStore(), auth: allowAll, docs: false } as const;

  it('does not mount /v1/originals without an object store', async () => {
    const previous = process.env.OBJECTSTORE_PLUGIN;
    delete process.env.OBJECTSTORE_PLUGIN;
    try {
      const app = createServer(baseOptions);

      expect((await request(app).get(`/v1/originals/${MANIFEST_ID}`)).status).toBe(404);
      const caps = await request(app).get('/v1/services/capabilities');
      expect(caps.body.supportedCapabilities).not.toContain('storeOriginals');
    } finally {
      if (previous !== undefined) process.env.OBJECTSTORE_PLUGIN = previous;
    }
  });

  it('mounts /v1/originals and advertises storeOriginals when configured', async () => {
    const originalsStore = createFakeObjectStore();
    const app = createServer({ ...baseOptions, originalsStore });

    const put = await request(app)
      .put(`/v1/originals/${MANIFEST_ID}`)
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send('signed');
    expect(put.status).toBe(204);

    const get = await request(app).get(`/v1/originals/${MANIFEST_ID}`);
    expect(get.status).toBe(200);
    expect(get.text).toBe('signed');
    expect(get.headers['x-content-type-options']).toBe('nosniff');

    const caps = await request(app).get('/v1/services/capabilities');
    expect(caps.body.supportedCapabilities).toContain('storeOriginals');
  });

  it('can be disabled with originalsStore: false', async () => {
    const app = createServer({
      ...baseOptions,
      objectStore: createFakeObjectStore(),
      originalsStore: false,
    });

    expect((await request(app).get(`/v1/originals/${MANIFEST_ID}`)).status).toBe(404);
  });
});
