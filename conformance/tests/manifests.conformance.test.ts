import { api, authHeader } from '../src/client';
import { createTestManifest } from '../src/fixtures';
import { hasCapability } from '../src/discovery';

describe('GET /manifests/:manifestId', () => {
  it('returns 404 for an unknown manifest id', async () => {
    const res = await api().get('/manifests/urn:c2pa:conformance-does-not-exist').set(authHeader());

    expect(res.status).toBe(404);
  });
});

const describeIfWritable = hasCapability('storeManifests') ? describe : describe.skip;

describeIfWritable('store -> fetch -> delete round trip (storeManifests)', () => {
  it('POST /manifests stores a manifest and returns a manifestId', async () => {
    const { manifestId } = await createTestManifest();

    expect(typeof manifestId).toBe('string');
    expect(manifestId.length).toBeGreaterThan(0);
  });

  it('GET /manifests/:id returns exactly the bytes just stored', async () => {
    const { manifestId, data } = await createTestManifest();

    const res = await api()
      .get(`/manifests/${encodeURIComponent(manifestId)}`)
      .set(authHeader())
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(Buffer.compare(res.body as Buffer, data)).toBe(0);
  });

  it('DELETE /manifests/:id removes it, and a subsequent GET 404s', async () => {
    const { manifestId } = await createTestManifest();

    const del = await api()
      .delete(`/manifests/${encodeURIComponent(manifestId)}`)
      .set(authHeader());
    expect(del.status).toBe(204);

    const get = await api()
      .get(`/manifests/${encodeURIComponent(manifestId)}`)
      .set(authHeader());
    expect(get.status).toBe(404);
  });
});
