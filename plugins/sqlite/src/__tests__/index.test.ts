import type { Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import sqliteDataStore from '../index';

describe('sqliteDataStore', () => {
  it('adds and retrieves a manifest', async () => {
    const data = Buffer.from('manifest-bytes');
    const manifestId = await sqliteDataStore.addManifest(data, 'application/c2pa');

    expect(manifestId).toMatch(/^urn:c2pa:/);
    expect(await sqliteDataStore.manifestExists(manifestId)).toBe(true);

    const entry = await sqliteDataStore.getManifest(manifestId);
    expect(entry).toEqual({ data, contentType: 'application/c2pa', receipt: null });
  });

  it('returns null for an unknown manifest', async () => {
    expect(await sqliteDataStore.getManifest('urn:c2pa:does-not-exist')).toBeNull();
    expect(await sqliteDataStore.manifestExists('urn:c2pa:does-not-exist')).toBe(false);
  });

  it('creates and looks up a binding', async () => {
    const manifestId = await sqliteDataStore.addManifest(Buffer.from('m1'), 'application/c2pa');

    expect(await sqliteDataStore.createBinding('binding-abc', manifestId)).toBe(true);

    const matches = await sqliteDataStore.findByBinding('binding-abc');
    expect(matches).toEqual([{ manifestId, similarityScore: 100 }]);
  });

  it('refuses to bind to a manifest that does not exist', async () => {
    expect(await sqliteDataStore.createBinding('binding-xyz', 'urn:c2pa:nope')).toBe(false);
    expect(await sqliteDataStore.findByBinding('binding-xyz')).toEqual([]);
  });

  it('updateBinding replaces all existing associations (PUT semantics)', async () => {
    const manifestA = await sqliteDataStore.addManifest(Buffer.from('a'), 'application/c2pa');
    const manifestB = await sqliteDataStore.addManifest(Buffer.from('b'), 'application/c2pa');

    await sqliteDataStore.createBinding('binding-put', manifestA);
    expect(await sqliteDataStore.updateBinding('binding-put', manifestB)).toBe(true);

    expect(await sqliteDataStore.findByBinding('binding-put')).toEqual([
      { manifestId: manifestB, similarityScore: 100 },
    ]);
  });

  it('updateBinding returns false for an unknown binding or manifest', async () => {
    const manifestId = await sqliteDataStore.addManifest(Buffer.from('c'), 'application/c2pa');

    expect(await sqliteDataStore.updateBinding('no-such-binding', manifestId)).toBe(false);

    await sqliteDataStore.createBinding('binding-existing', manifestId);
    expect(await sqliteDataStore.updateBinding('binding-existing', 'urn:c2pa:nope')).toBe(false);
  });

  it('stores and retrieves a receipt', async () => {
    const manifestId = await sqliteDataStore.addManifest(Buffer.from('r'), 'application/c2pa');
    const receipt: Receipt = {
      '@context': { c2pa: 'https://c2pa.org', receipt: 'https://c2pa.org/receipt' },
      '@type': 'Receipt',
      repository: { uri: 'https://example.com', manifestId },
      anchor: { uri: 'https://example.com/anchor', proof: { alg: 'hmac-sha256', value: 'abc' } },
    };

    expect(await sqliteDataStore.getReceipt(manifestId)).toBeNull();
    expect(await sqliteDataStore.setReceipt(manifestId, receipt)).toBe(true);
    expect(await sqliteDataStore.getReceipt(manifestId)).toEqual(receipt);
  });

  it('setReceipt/getReceipt return false/null for an unknown manifest', async () => {
    const receipt = {} as Receipt;
    expect(await sqliteDataStore.setReceipt('urn:c2pa:nope', receipt)).toBe(false);
    expect(await sqliteDataStore.getReceipt('urn:c2pa:nope')).toBeNull();
  });

  it('deleting a manifest cascades to its bindings', async () => {
    const manifestId = await sqliteDataStore.addManifest(Buffer.from('d'), 'application/c2pa');
    await sqliteDataStore.createBinding('binding-cascade', manifestId);

    expect(await sqliteDataStore.deleteManifest(manifestId)).toBe(true);
    expect(await sqliteDataStore.manifestExists(manifestId)).toBe(false);
    expect(await sqliteDataStore.findByBinding('binding-cascade')).toEqual([]);
  });

  it('deleteManifest returns false for an unknown manifest', async () => {
    expect(await sqliteDataStore.deleteManifest('urn:c2pa:nope')).toBe(false);
  });

  it('findByBinding respects maxResults', async () => {
    const manifestIds = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        sqliteDataStore.addManifest(Buffer.from(`m${i}`), 'application/c2pa'),
      ),
    );
    for (const manifestId of manifestIds) {
      await sqliteDataStore.createBinding('binding-many', manifestId);
    }

    const matches = await sqliteDataStore.findByBinding('binding-many', 2);
    expect(matches).toHaveLength(2);
  });
});
