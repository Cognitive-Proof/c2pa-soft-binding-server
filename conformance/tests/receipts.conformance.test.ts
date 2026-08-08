import { api, authHeader } from '../src/client';
import { createTestManifest } from '../src/fixtures';
import { hasCapability } from '../src/discovery';

const describeIfWritable = hasCapability('storeManifests') ? describe : describe.skip;

describeIfWritable('receipts (storeManifests)', () => {
  it('returnReceipt=true yields a receipt that is retrievable and verifiable', async () => {
    const { manifestId, receipt } = await createTestManifest({ returnReceipt: true });

    expect(receipt).toBeDefined();
    expect(receipt?.['@type']).toBe('org.c2pa.manifest-receipt');

    const get = await api()
      .get(`/manifests/${encodeURIComponent(manifestId)}/receipts`)
      .set(authHeader());
    expect(get.status).toBe(200);
    expect((get.body.repository as { manifestId?: string } | undefined)?.manifestId).toBe(
      manifestId,
    );

    const verify = await api()
      .post(`/manifests/${encodeURIComponent(manifestId)}/receipts`)
      .set(authHeader())
      .send(receipt);
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);
  });
});
