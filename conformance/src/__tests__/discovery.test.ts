import {
  fetchCapabilities,
  fetchWellKnown,
  getCachedCapabilities,
  hasCapability,
} from '../discovery';
import { startStubServer, type StubServer } from './helpers/stubServer';

describe('fetchCapabilities', () => {
  let server: StubServer;

  afterEach(async () => {
    await server?.close();
  });

  it('returns the parsed capabilities on 200', async () => {
    server = await startStubServer((req) => {
      if (req.url === '/services/capabilities') {
        return {
          status: 200,
          body: { c2paSpecificationVersion: '2.4.0', supportedCapabilities: ['storeManifests'] },
        };
      }
      return { status: 404 };
    });

    const capabilities = await fetchCapabilities(server.baseUrl);

    expect(capabilities.supportedCapabilities).toEqual(['storeManifests']);
  });

  it('falls back to assuming every optional capability is present when the endpoint is missing', async () => {
    server = await startStubServer(() => ({ status: 404 }));

    const capabilities = await fetchCapabilities(server.baseUrl);

    expect(capabilities.supportedCapabilities).toEqual(
      expect.arrayContaining([
        'queryByContent',
        'queryByReference',
        'storeManifests',
        'storeBindings',
      ]),
    );
  });
});

describe('fetchWellKnown', () => {
  let server: StubServer;

  afterEach(async () => {
    await server?.close();
  });

  it('fetches from the domain root, not the /v1-prefixed base URL', async () => {
    server = await startStubServer((req) => {
      if (req.url === '/.well-known/c2pa-soft-binding-resolution') {
        return { status: 200, body: { apiEndpoint: '/v1', c2paSpecificationVersion: '2.4.0' } };
      }
      return { status: 404 };
    });

    const result = await fetchWellKnown(`${server.baseUrl}/v1`);

    expect(result).toEqual({ apiEndpoint: '/v1', c2paSpecificationVersion: '2.4.0' });
  });

  it('returns undefined when the document is missing', async () => {
    server = await startStubServer(() => ({ status: 404 }));

    expect(await fetchWellKnown(server.baseUrl)).toBeUndefined();
  });
});

describe('getCachedCapabilities / hasCapability', () => {
  const original = process.env.CONFORMANCE_CAPABILITIES;

  afterEach(() => {
    if (original === undefined) delete process.env.CONFORMANCE_CAPABILITIES;
    else process.env.CONFORMANCE_CAPABILITIES = original;
  });

  it('reads capabilities from CONFORMANCE_CAPABILITIES', () => {
    process.env.CONFORMANCE_CAPABILITIES = JSON.stringify({
      supportedCapabilities: ['storeBindings'],
    });

    expect(hasCapability('storeBindings')).toBe(true);
    expect(hasCapability('storeManifests')).toBe(false);
    expect(getCachedCapabilities().supportedCapabilities).toEqual(['storeBindings']);
  });

  it('assumes every capability is present when the env var is unset', () => {
    delete process.env.CONFORMANCE_CAPABILITIES;

    expect(hasCapability('queryByReference')).toBe(true);
  });
});
