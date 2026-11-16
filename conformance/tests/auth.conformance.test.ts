import { api, authHeader } from '../src/client';
import { hasCapability } from '../src/discovery';
import { getConformanceEnv } from '../src/env';
import { createTestManifest, createTestManifestBytes, trackForCleanup } from '../src/fixtures';

// The spec documents 403 ("Client not allowed to perform this operation") and
// no 401, but 401 is the usual HTTP answer to a missing or invalid bearer
// token, so either passes.
const REJECTED = [401, 403];

const describeIfWritable = hasCapability('storeManifests') ? describe : describe.skip;
const describeIfUploadsNeedAuth =
  hasCapability('storeManifests') && !getConformanceEnv().anonymousUploads
    ? describe
    : describe.skip;

/**
 * POSTs a valid signed manifest without (or with a bad) token. A valid body
 * means a store that validates uploads can only reject it for auth, and if
 * the store accepts it anyway the manifest still gets cleaned up.
 */
async function postManifest(headers: Record<string, string>) {
  const res = await api()
    .post('/manifests')
    .set(headers)
    .set('Content-Type', 'application/c2pa')
    .send(await createTestManifestBytes());

  if (res.status === 200 && typeof res.body?.manifestId === 'string') {
    trackForCleanup(res.body.manifestId);
  }
  return res;
}

describeIfUploadsNeedAuth('auth enforcement on POST /manifests', () => {
  it('POST /manifests without a token is rejected (401 or 403)', async () => {
    const res = await postManifest({});

    expect(REJECTED).toContain(res.status);
  });

  it('POST /manifests with a garbage bearer token is rejected (401 or 403)', async () => {
    const res = await postManifest({ Authorization: 'Bearer not-a-real-token' });

    expect(REJECTED).toContain(res.status);
  });
});

describeIfWritable('auth enforcement on DELETE /manifests/:id', () => {
  it('DELETE without a token is rejected (401 or 403) and leaves the manifest in place', async () => {
    const { manifestId } = await createTestManifest();
    const path = `/manifests/${encodeURIComponent(manifestId)}`;

    const del = await api().delete(path);
    expect(REJECTED).toContain(del.status);

    const get = await api().get(path).set(authHeader());
    expect(get.status).toBe(200);
  });
});

describe('auth on GET /manifests/:manifestId', () => {
  // Deliberately lenient: the spec allows per-manifest public/private policy
  // (this server's own isAuthRequired.manifests option is exactly that), so an
  // unauthenticated fetch isn't required to be a strict 401 here.
  it('returns 200, 401, 403, or 404 for an unauthenticated fetch', async () => {
    const res = await api().get('/manifests/urn:c2pa:conformance-auth-check');

    expect([200, 401, 403, 404]).toContain(res.status);
  });
});
