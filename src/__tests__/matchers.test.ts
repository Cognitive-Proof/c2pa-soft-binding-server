import type { RequestHandler } from 'express';
import request from 'supertest';
import type { ManifestReader } from '@cognitiveproof/softbinding-api-plugin-types';
import { createServer } from '../index';
import { createFakeDataStore } from './helpers/fakeDataStore';
import { createFakeMatcher } from './helpers/fakeMatcher';

const allowAll: RequestHandler = (_req, _res, next) => next();
const FP = 'com.example.fingerprint';
const WM = 'com.example.watermark';

// A reader that treats the upload as JSON { id, bindings } instead of JUMBF.
const jsonReader: ManifestReader = (data) => {
  const { id, bindings } = JSON.parse(data.toString('utf8'));
  return { manifestId: id, bindings };
};

function buildServer(readManifest: ManifestReader | undefined = jsonReader) {
  const dataStore = createFakeDataStore();
  const matcher = createFakeMatcher();
  const app = createServer({
    dataStore,
    auth: allowAll,
    docs: false,
    rateLimit: false,
    readManifest,
    matchers: { [FP]: matcher },
  });
  return { app, dataStore, matcher };
}

function upload(app: ReturnType<typeof createServer>, body: unknown) {
  return request(app)
    .post('/v1/manifests')
    .set('Content-Type', 'application/c2pa')
    .send(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
}

describe('readManifest', () => {
  it('stores the manifest under the id it reports and indexes bindings that have a matcher', async () => {
    const { app, dataStore, matcher } = buildServer();

    const res = await upload(app, {
      id: 'urn:c2pa:one',
      bindings: [
        { alg: FP, value: 'abcdef' },
        { alg: WM, value: 'not-indexed' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.manifestId).toBe('urn:c2pa:one');
    expect(await dataStore.manifestExists('urn:c2pa:one')).toBe(true);
    expect(matcher.entries.get('urn:c2pa:one')).toEqual(['abcdef']);
    // Bindings without a matcher aren't added to the data store automatically.
    expect(await dataStore.findByBinding('not-indexed')).toEqual([]);
  });

  it('refuses the upload with 400 when the reader throws', async () => {
    const { app, dataStore } = buildServer(() => {
      throw new Error('claimSignature.mismatch');
    });

    const res = await upload(app, 'anything');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid C2PA Manifest Store: claimSignature.mismatch');
    expect(await dataStore.manifestExists('urn:c2pa:one')).toBe(false);
  });

  it('refuses a binding the matcher rejects and does not keep the manifest', async () => {
    const { app, dataStore, matcher } = buildServer();

    const res = await upload(app, {
      id: 'urn:c2pa:bad',
      bindings: [
        { alg: FP, value: 'abcdef' },
        { alg: FP, value: '!broken' },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Invalid soft binding: bad value !broken/);
    expect(await dataStore.manifestExists('urn:c2pa:bad')).toBe(false);
    expect(matcher.entries.has('urn:c2pa:bad')).toBe(false);
  });

  it('does not index an idempotent re-upload twice', async () => {
    const { app, matcher } = buildServer();
    const body = { id: 'urn:c2pa:same', bindings: [{ alg: FP, value: 'abcdef' }] };

    expect((await upload(app, body)).status).toBe(200);
    expect((await upload(app, body)).status).toBe(200);

    expect(matcher.entries.get('urn:c2pa:same')).toEqual(['abcdef']);
  });

  it('rejects the same id with different bytes as before', async () => {
    const { app } = buildServer();
    await upload(app, { id: 'urn:c2pa:dup', bindings: [] });

    const res = await upload(app, { id: 'urn:c2pa:dup', bindings: [{ alg: FP, value: 'x' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already in use/);
  });

  it('removes a deleted manifest from the matchers', async () => {
    const { app, matcher } = buildServer();
    await upload(app, { id: 'urn:c2pa:gone', bindings: [{ alg: FP, value: 'abcdef' }] });

    const res = await request(app).delete('/v1/manifests/urn:c2pa:gone');

    expect(res.status).toBe(204);
    expect(matcher.entries.has('urn:c2pa:gone')).toBe(false);
  });
});

describe('matchers', () => {
  async function seeded() {
    const server = buildServer();
    await upload(server.app, { id: 'urn:c2pa:near', bindings: [{ alg: FP, value: 'abcdefgh' }] });
    await upload(server.app, { id: 'urn:c2pa:far', bindings: [{ alg: FP, value: 'abcdzzzz' }] });
    await server.dataStore.createBinding('abcdefgh', 'urn:c2pa:far');
    return server;
  }

  it('answers GET byBinding for its algorithm, best match first', async () => {
    const { app } = await seeded();

    const res = await request(app).get(`/v1/matches/byBinding?alg=${FP}&value=abcdefgx`);

    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([
      { manifestId: 'urn:c2pa:near', similarityScore: 70 },
      { manifestId: 'urn:c2pa:far', similarityScore: 40 },
    ]);
  });

  it('answers POST byBinding and honours maxResults', async () => {
    const { app } = await seeded();

    const res = await request(app)
      .post('/v1/matches/byBinding?maxResults=1')
      .send({ alg: FP, value: 'abcdefgh' });

    expect(res.body.matches).toEqual([{ manifestId: 'urn:c2pa:near', similarityScore: 80 }]);
  });

  it('leaves other algorithms to the data store', async () => {
    const { app } = await seeded();

    const res = await request(app).get(`/v1/matches/byBinding?alg=${WM}&value=abcdefgh`);

    expect(res.body.matches).toEqual([{ manifestId: 'urn:c2pa:far', similarityScore: 1 }]);
  });

  it('returns 400 for a value the matcher refuses', async () => {
    const { app } = await seeded();

    const res = await request(app).get(`/v1/matches/byBinding?alg=${FP}&value=!nope`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad value !nope');
  });

  it('answers byContent through the matcher for the hint algorithm', async () => {
    const { app } = await seeded();

    const res = await request(app)
      .post(`/v1/matches/byContent?hintAlg=${FP}&hintValue=abcdefgh`)
      .set('Content-Type', 'text/plain')
      .send('no watermark here');

    expect(res.status).toBe(200);
    expect(res.body.matches[0]).toEqual({ manifestId: 'urn:c2pa:near', similarityScore: 80 });
  });

  it('answers byContent through the matcher for an extracted value', async () => {
    const matcher = createFakeMatcher();
    await matcher.index('urn:c2pa:x', 'hello world');
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      rateLimit: false,
      parseManifestId: () => 'unused',
      extractors: { [FP]: async (buffer) => buffer.toString('utf8') },
      matchers: { [FP]: matcher },
    });

    const res = await request(app)
      .post(`/v1/matches/byContent?alg=${FP}`)
      .set('Content-Type', 'text/plain')
      .send('hello there');

    expect(res.body.matches).toEqual([{ manifestId: 'urn:c2pa:x', similarityScore: 60 }]);
  });

  it('lists matcher algorithms in supportedAlgorithms by their declared kind', async () => {
    const app = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      rateLimit: false,
      parseManifestId: () => 'unused',
      extractors: { [FP]: async () => null },
      matchers: { [FP]: createFakeMatcher(), 'com.example.mark': createFakeMatcher('watermark') },
    });

    const res = await request(app).get('/v1/services/supportedAlgorithms');

    expect(res.body).toEqual({
      fingerprints: [{ alg: FP }],
      watermarks: [{ alg: 'com.example.mark' }],
    });
  });
});
