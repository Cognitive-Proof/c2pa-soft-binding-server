import crypto from 'crypto';
import type { Receipt } from '@cognitiveproof/softbinding-api-plugin-types';

const PROOF_ALG = 'HMAC-SHA256';

function canonicalPayload(repositoryUri: string, manifestId: string, anchorUri: string): string {
  return JSON.stringify({ alg: PROOF_ALG, repositoryUri, manifestId, anchorUri });
}

export function buildReceipt(manifestId: string, repoUri: string, secret: string): Receipt {
  const anchorUri = `${repoUri}/v1/manifests/${encodeURIComponent(manifestId)}/receipts`;
  const proof = crypto
    .createHmac('sha256', secret)
    .update(canonicalPayload(repoUri, manifestId, anchorUri))
    .digest('base64url');

  return {
    '@context': {
      c2pa: 'https://c2pa.org/ns/',
      receipt: 'https://c2pa.org/ns/manifest-receipt#',
    },
    '@type': 'org.c2pa.manifest-receipt',
    repository: {
      uri: repoUri,
      manifestId,
    },
    anchor: {
      uri: anchorUri,
      proof: {
        alg: PROOF_ALG,
        value: proof,
      },
    },
  };
}

// Verifies that every integrity-sensitive field of a receipt (repository.uri,
// repository.manifestId, anchor.uri, anchor.proof.alg) is consistent with the
// signed proof — not just the manifest ID.
export function verifyReceipt(receipt: Receipt, secret: string): boolean {
  const { repository, anchor } = receipt;

  if (anchor?.proof?.alg !== PROOF_ALG) return false;
  if (!repository?.uri || !repository?.manifestId || !anchor?.uri || !anchor?.proof?.value) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonicalPayload(repository.uri, repository.manifestId, anchor.uri))
    .digest('base64url');

  try {
    const actual = Buffer.from(anchor.proof.value);
    const expectedBuf = Buffer.from(expected);
    return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf);
  } catch {
    return false;
  }
}
