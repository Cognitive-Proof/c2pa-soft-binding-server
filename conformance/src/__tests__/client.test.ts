import { api, authHeader } from '../client';
import { resetConformanceEnvForTests } from '../env';
import { startStubServer, type StubServer } from './helpers/stubServer';

describe('api / authHeader', () => {
  let server: StubServer;

  afterEach(async () => {
    await server?.close();
    resetConformanceEnvForTests();
    delete process.env.CONFORMANCE_BASE_URL;
    delete process.env.CONFORMANCE_TOKEN;
  });

  it('sends requests to the configured base URL with the bearer token attached', async () => {
    server = await startStubServer(() => ({ status: 200, body: { ok: true } }));
    process.env.CONFORMANCE_BASE_URL = server.baseUrl;
    process.env.CONFORMANCE_TOKEN = 'my-token';

    const res = await api().get('/services/status').set(authHeader());

    expect(res.status).toBe(200);
    expect(server.requests[0].method).toBe('GET');
    expect(server.requests[0].url).toBe('/services/status');
    expect(server.requests[0].headers.authorization).toBe('Bearer my-token');
  });
});
