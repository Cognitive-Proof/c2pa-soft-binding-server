import { api, authHeader } from '../src/client';
import { createTestManifest } from '../src/fixtures';
import { hasCapability } from '../src/discovery';

const describeIfBindable =
  hasCapability('storeBindings') && hasCapability('storeManifests') ? describe : describe.skip;

describeIfBindable('bindings (storeBindings)', () => {
  it('creates a binding, finds it via GET /matches/byBinding, then updates it', async () => {
    const first = await createTestManifest();
    const second = await createTestManifest();
    const bindingValue = `conformance-binding-${Date.now()}`;

    const create = await api()
      .post('/bindings')
      .set(authHeader())
      .send({ bindingValue, manifestId: first.manifestId });
    expect(create.status).toBe(204);

    const query = await api()
      .get(`/matches/byBinding?value=${encodeURIComponent(bindingValue)}&alg=conformance-test`)
      .set(authHeader());
    expect(query.status).toBe(200);
    const manifestIds = (query.body.matches as Array<{ manifestId: string }>).map(
      (match) => match.manifestId,
    );
    expect(manifestIds).toContain(first.manifestId);

    const update = await api()
      .put('/bindings')
      .set(authHeader())
      .send({ bindingValue, manifestId: second.manifestId });
    expect(update.status).toBe(204);
  });

  it('POST /bindings to an unknown manifestId returns 404', async () => {
    const res = await api()
      .post('/bindings')
      .set(authHeader())
      .send({
        bindingValue: `conformance-binding-${Date.now()}`,
        manifestId: 'urn:c2pa:conformance-does-not-exist',
      });

    expect(res.status).toBe(404);
  });
});
