import { api } from '../src/client';
import { hasCapability } from '../src/discovery';

const describeIfWritable = hasCapability('storeManifests') ? describe : describe.skip;

describeIfWritable('auth enforcement on store endpoints', () => {
  it('POST /manifests without a token is rejected (401)', async () => {
    const res = await api()
      .post('/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(Buffer.from('conformance-no-auth'));

    expect(res.status).toBe(401);
  });

  it('POST /manifests with a garbage bearer token is rejected (401)', async () => {
    const res = await api()
      .post('/manifests')
      .set('Authorization', 'Bearer not-a-real-token')
      .set('Content-Type', 'application/c2pa')
      .send(Buffer.from('conformance-bad-token'));

    expect(res.status).toBe(401);
  });

  it('DELETE /manifests/:id without a token is rejected (401)', async () => {
    const res = await api().delete('/manifests/urn:c2pa:conformance-auth-check');

    expect(res.status).toBe(401);
  });
});

describe('auth on GET /manifests/:manifestId', () => {
  // Deliberately lenient: the spec allows per-manifest public/private policy
  // (this server's own isManifestAuthRequired option is exactly that), so an
  // unauthenticated fetch isn't required to be a strict 401 here.
  it('returns 200, 401, 403, or 404 for an unauthenticated fetch', async () => {
    const res = await api().get('/manifests/urn:c2pa:conformance-auth-check');

    expect([200, 401, 403, 404]).toContain(res.status);
  });
});
