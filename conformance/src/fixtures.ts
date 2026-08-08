import { randomUUID } from 'crypto';
import { api, authHeader } from './client';
import { getConformanceEnv } from './env';

const createdManifestIds: string[] = [];

/**
 * Marker bytes embedded in every fixture manifest this harness creates, so
 * any data left behind by an interrupted or `--no-cleanup` run is easy to
 * identify and hand-delete on the target.
 */
export function markerPayload(): Buffer {
  return Buffer.from(`softbinding-conformance-fixture:${randomUUID()}`);
}

export interface TestManifest {
  manifestId: string;
  data: Buffer;
  receipt?: Record<string, unknown>;
}

/** POSTs a small marker manifest and tracks it for cleanup. */
export async function createTestManifest(
  options: { returnReceipt?: boolean } = {},
): Promise<TestManifest> {
  const data = markerPayload();
  const res = await api()
    .post(`/manifests${options.returnReceipt ? '?returnReceipt=true' : ''}`)
    .set(authHeader())
    .set('Content-Type', 'application/c2pa')
    .send(data);

  if (res.status !== 200 || typeof res.body?.manifestId !== 'string') {
    throw new Error(
      `Fixture setup failed: POST /manifests returned ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  const manifestId: string = res.body.manifestId;
  createdManifestIds.push(manifestId);
  return { manifestId, data, receipt: res.body.receipt };
}

/** Deletes every fixture manifest created so far, unless cleanup is disabled. */
export async function cleanupAll(): Promise<void> {
  if (!getConformanceEnv().cleanup) {
    if (createdManifestIds.length > 0) {
      console.log(
        `[conformance] --no-cleanup: leaving ${createdManifestIds.length} fixture manifest(s) in place:`,
        createdManifestIds,
      );
    }
    return;
  }

  const remaining = createdManifestIds.splice(0, createdManifestIds.length);
  for (const manifestId of remaining) {
    try {
      await api()
        .delete(`/manifests/${encodeURIComponent(manifestId)}`)
        .set(authHeader());
    } catch (err) {
      console.warn(`[conformance] Failed to clean up fixture manifest ${manifestId}:`, err);
    }
  }
}
