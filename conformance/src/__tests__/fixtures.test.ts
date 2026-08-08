import { createTestManifest, cleanupAll } from '../fixtures';
import { resetConformanceEnvForTests } from '../env';
import { startStubServer, type StubServer } from './helpers/stubServer';

describe('createTestManifest / cleanupAll', () => {
  let server: StubServer;

  afterEach(async () => {
    await server?.close();
    resetConformanceEnvForTests();
    delete process.env.CONFORMANCE_BASE_URL;
    delete process.env.CONFORMANCE_TOKEN;
    delete process.env.CONFORMANCE_CLEANUP;
  });

  it('creates a manifest via POST /manifests and deletes it during cleanup', async () => {
    let deletedId: string | undefined;
    server = await startStubServer((req) => {
      if (req.method === 'POST' && req.url === '/manifests') {
        return { status: 200, body: { manifestId: 'urn:c2pa:test-1' } };
      }
      if (req.method === 'DELETE') {
        deletedId = decodeURIComponent(req.url.replace('/manifests/', ''));
        return { status: 204 };
      }
      return { status: 404 };
    });
    process.env.CONFORMANCE_BASE_URL = server.baseUrl;
    process.env.CONFORMANCE_TOKEN = 'test-token';

    const { manifestId } = await createTestManifest();
    expect(manifestId).toBe('urn:c2pa:test-1');

    await cleanupAll();
    expect(deletedId).toBe('urn:c2pa:test-1');
  });

  it('requests returnReceipt=true and returns the receipt when asked', async () => {
    server = await startStubServer((req) => {
      if (req.method === 'POST' && req.url === '/manifests?returnReceipt=true') {
        return {
          status: 200,
          body: { manifestId: 'urn:c2pa:test-receipt', receipt: { ok: true } },
        };
      }
      if (req.method === 'DELETE') return { status: 204 };
      return { status: 404 };
    });
    process.env.CONFORMANCE_BASE_URL = server.baseUrl;
    process.env.CONFORMANCE_TOKEN = 'test-token';

    const result = await createTestManifest({ returnReceipt: true });

    expect(result.receipt).toEqual({ ok: true });
    await cleanupAll();
  });

  it('skips deletion when cleanup is disabled', async () => {
    let deleteCalled = false;
    server = await startStubServer((req) => {
      if (req.method === 'POST') return { status: 200, body: { manifestId: 'urn:c2pa:test-2' } };
      if (req.method === 'DELETE') {
        deleteCalled = true;
        return { status: 204 };
      }
      return { status: 404 };
    });
    process.env.CONFORMANCE_BASE_URL = server.baseUrl;
    process.env.CONFORMANCE_TOKEN = 'test-token';
    process.env.CONFORMANCE_CLEANUP = 'false';

    await createTestManifest();
    await cleanupAll();

    expect(deleteCalled).toBe(false);
  });

  it('throws a descriptive error when manifest creation fails', async () => {
    server = await startStubServer(() => ({ status: 500, body: { error: 'boom' } }));
    process.env.CONFORMANCE_BASE_URL = server.baseUrl;
    process.env.CONFORMANCE_TOKEN = 'test-token';

    await expect(createTestManifest()).rejects.toThrow(/Fixture setup failed/);
  });
});
