// Prevents Server-Side Request Forgery on the /matches/byReference endpoint.
// Checks that a URL is HTTPS and that its resolved IP is not a private range.
//
// Note: this is defence-in-depth only. A production system should also use
// signed, short-lived URLs (as recommended by the spec) and network-level
// egress controls to prevent DNS rebinding attacks.

import { promises as dns, LookupAddress } from 'dns';

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./, // link-local
  /^0\./, // "this" network
  /^::1$/, // IPv6 loopback
  /^fc[0-9a-f]{2}:/i, // IPv6 unique local
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

export async function validateReferenceUrl(urlStr: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS reference URLs are permitted');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error('Could not resolve reference URL hostname');
  }

  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      throw new Error('Reference URL resolves to a private or reserved IP address');
    }
  }
}
