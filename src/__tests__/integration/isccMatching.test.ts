/**
 * End-to-end: createServer() with the c2pa-manifest reader (real c2pa-rs via
 * @contentauth/c2pa-node) and the ISCC matcher (@iscc/lib). Run with
 * `npm run test:integration` after building the plugins.
 *
 * Uploads a sidecar signed with an io.iscc.v0 soft binding (IEP-0020 test
 * vector 1), then finds it by an exact and a similar ISCC, and by content.
 */
import fs from 'fs';
import path from 'path';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createC2paManifestReader } from '@cognitiveproof/softbinding-api-plugin-c2pa-manifest';
import {
  encodeSeq,
  decodeSeq,
  isccExtractor,
  isccMatcher,
  ISCC_ALGORITHM,
  unitToString,
} from '@cognitiveproof/softbinding-api-plugin-iscc';
import { createServer } from '../../index';
import { createFakeDataStore } from '../helpers/fakeDataStore';

const allowAll: RequestHandler = (_req, _res, next) => next();
const FIXTURES = path.join(__dirname, '../../../plugins/c2pa-manifest/src/__tests__/fixtures');
const SIGNED = fs.readFileSync(path.join(FIXTURES, 'iscc-signed.c2pa'));
const TEST_CA = fs.readFileSync(path.join(FIXTURES, 'test-ca.pem'), 'utf8');
const VECTOR_1 =
  'AAdXjHyPv721jyn2Pv6zhxVT+qdf+XRY1J7/XuTd82u2ySAHqIJIxTqFLI1+nFRwR8mjbEBStqyr7x4qTOFeWG4MswUwBwW0HzRySTIl0n7cvbYyNoRq' +
  'U+4o3speNWGswMm734G1QAelIq9KLJy/aoCJJK/SrPoHkzR7k2Z49ZguIv3T3UoONw==';

function buildApp() {
  return createServer({
    dataStore: createFakeDataStore(),
    auth: allowAll,
    docs: false,
    rateLimit: false,
    readManifest: createC2paManifestReader({ trustAnchors: TEST_CA }),
    matchers: { [ISCC_ALGORITHM]: isccMatcher() },
    extractors: { [ISCC_ALGORITHM]: isccExtractor },
  });
}

/** The Content-Code of vector 1 with its first 30 bits flipped (similarity 88). */
function similarContent(): string {
  const content = decodeSeq(Buffer.from(VECTOR_1, 'base64'))[1];
  const body = Buffer.from(content.body);
  for (let i = 0; i < 30; i++) body[i >> 3] ^= 0x80 >> (i & 7);
  return encodeSeq([unitToString({ ...content, body })]).toString('base64');
}

describe('ISCC soft bindings end to end', () => {
  it('indexes an uploaded manifest and finds it by exact and similar ISCC', async () => {
    const app = buildApp();

    const upload = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(SIGNED);
    expect(upload.status).toBe(200);
    const { manifestId } = upload.body;
    expect(manifestId).toMatch(/^urn:c2pa:/);

    const exact = await request(app)
      .post('/v1/matches/byBinding')
      .send({ alg: ISCC_ALGORITHM, value: VECTOR_1 });
    expect(exact.body).toEqual({ matches: [{ manifestId, similarityScore: 100 }] });

    const similar = await request(app)
      .get('/v1/matches/byBinding')
      .query({ alg: ISCC_ALGORITHM, value: similarContent() });
    expect(similar.body).toEqual({ matches: [{ manifestId, similarityScore: 88 }] });

    const algorithms = await request(app).get('/v1/services/supportedAlgorithms');
    expect(algorithms.body.fingerprints).toContainEqual({ alg: ISCC_ALGORITHM });

    expect((await request(app).delete(`/v1/manifests/${manifestId}`)).status).toBe(204);
    const gone = await request(app)
      .post('/v1/matches/byBinding')
      .send({ alg: ISCC_ALGORITHM, value: VECTOR_1 });
    expect(gone.body).toEqual({ matches: [] });
  });

  it('refuses a tampered manifest without indexing it', async () => {
    const app = buildApp();
    const tampered = Buffer.from(SIGNED);
    tampered[tampered.indexOf(Buffer.from(VECTOR_1.slice(8, 24)))] ^= 1;

    const res = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(tampered);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assertion\.hashedURI\.mismatch/);
  });

  it('finds a manifest by content through the extractor', async () => {
    const text = Buffer.from(
      'A short article that a publisher signed and later found copied elsewhere.',
    );
    const matcher = isccMatcher();
    const value = await isccExtractor(text, 'text/plain');
    await matcher.index('urn:c2pa:article', value!);
    const byContent = createServer({
      dataStore: createFakeDataStore(),
      auth: allowAll,
      docs: false,
      rateLimit: false,
      parseManifestId: () => 'unused',
      matchers: { [ISCC_ALGORITHM]: matcher },
      extractors: { [ISCC_ALGORITHM]: isccExtractor },
    });

    const res = await request(byContent)
      .post(`/v1/matches/byContent?alg=${ISCC_ALGORITHM}`)
      .set('Content-Type', 'text/plain')
      .send(text);

    expect(res.body).toEqual({
      matches: [{ manifestId: 'urn:c2pa:article', similarityScore: 100 }],
    });
  });
});
