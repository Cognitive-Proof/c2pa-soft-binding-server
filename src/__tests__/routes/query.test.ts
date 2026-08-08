import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createQueryRouter } from '../../routes/query';
import { createSoftBindingRegistry } from '../../softBinding';
import { validateReferenceUrl } from '../../utils/ssrf';
import { createFakeDataStore } from '../helpers/fakeDataStore';

jest.mock('../../utils/ssrf', () => ({
  validateReferenceUrl: jest.fn(),
}));

const allowAll: RequestHandler = (_req, _res, next) => next();
const mockedValidateReferenceUrl = validateReferenceUrl as jest.MockedFunction<
  typeof validateReferenceUrl
>;

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
      maxQueryValueLength: 2048,
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

  it('returns 414 when value exceeds maxQueryValueLength', async () => {
    const { app } = buildApp({ maxQueryValueLength: 10 });

    const res = await request(app).get(`/v1/matches/byBinding?value=${'x'.repeat(11)}&alg=test`);

    expect(res.status).toBe(414);
    expect(res.body.error).toMatch(/POST \/matches\/byBinding/);
  });

  it('does not 414 a value at exactly maxQueryValueLength', async () => {
    const { app } = buildApp({ maxQueryValueLength: 10 });

    const res = await request(app).get(`/v1/matches/byBinding?value=${'x'.repeat(10)}&alg=test`);

    expect(res.status).toBe(200);
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
  beforeEach(() => {
    mockedValidateReferenceUrl.mockReset();
    mockedValidateReferenceUrl.mockImplementation(async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS reference URLs are permitted');
      }
      if (parsed.hostname === '127.0.0.1') {
        throw new Error('Reference URL resolves to a private or reserved IP address');
      }
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns 400 when referenceUrl or assetLength is missing', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/a.jpg' });

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

  it('stops reading a chunked response when it exceeds maxReferenceSize', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    const { app } = buildApp({ maxReferenceSize: 10 });

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/a.jpg', assetLength: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds the server limit of 10 bytes/);
    expect(cancelled).toBe(true);
  });

  it('keeps the timeout active while reading the response body', async () => {
    jest.useFakeTimers();
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      markFetchStarted();
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    });
    const { app } = buildApp();

    const responsePromise = Promise.resolve(
      request(app)
        .post('/v1/matches/byReference')
        .send({ referenceUrl: 'https://example.com/a.jpg', assetLength: 100 }),
    );
    await fetchStarted;
    await jest.advanceTimersByTimeAsync(30_000);
    const res = await responsePromise;

    expect(res.status).toBe(504);
    expect(res.body.error).toBe('Reference download timed out');
  });

  it('validates and follows a public redirect', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: '/final.jpg' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('image-bytes'), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      );
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/start', assetLength: 11 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [] });
    expect(mockedValidateReferenceUrl).toHaveBeenNthCalledWith(1, 'https://example.com/start');
    expect(mockedValidateReferenceUrl).toHaveBeenNthCalledWith(2, 'https://example.com/final.jpg');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/start',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/final.jpg',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('rejects a redirect to a private address before fetching it', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://127.0.0.1/internal' },
      }),
    );
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/start', assetLength: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private or reserved IP address/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedValidateReferenceUrl).toHaveBeenNthCalledWith(2, 'https://127.0.0.1/internal');
  });

  it('returns 400 for a malformed region', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({
        referenceUrl: 'https://example.com/a.jpg',
        assetLength: 100,
        region: [{ type: 'spatial', shape: { kind: 'rectangle' } }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/region/);
  });

  it('returns 400 when region is not an array', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/a.jpg', assetLength: 100, region: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/region must be an array/);
  });

  it('forwards a valid region to the extractor', async () => {
    const extractor = jest.fn().mockResolvedValue(null);
    const softBinding = createSoftBindingRegistry({ 'com.example.watermark.v1': extractor });
    const { app } = buildApp({ softBinding });
    const region = [{ type: 'frame', frame: { start: 0, end: 5 } }];
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(Buffer.from('image-bytes'), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );

    const res = await request(app)
      .post('/v1/matches/byReference?alg=com.example.watermark.v1')
      .send({ referenceUrl: 'https://example.com/a.jpg', assetLength: 11, region });

    expect(res.status).toBe(200);
    expect(extractor).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', region);
  });

  it('rejects a reference that exceeds the redirect limit', async () => {
    let redirectNumber = 0;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      redirectNumber += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: `/redirect-${redirectNumber}` },
      });
    });
    const { app } = buildApp();

    const res = await request(app)
      .post('/v1/matches/byReference')
      .send({ referenceUrl: 'https://example.com/start', assetLength: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeded 5 redirects/);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
