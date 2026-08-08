/**
 * Reads the target/credentials the conformance suite runs against. Set by
 * `cli.ts` before spawning Jest, or manually when invoking
 * `jest --config jest.conformance.config.js` directly.
 */
export interface ConformanceEnv {
  baseUrl: string;
  token: string;
  cleanup: boolean;
}

let cached: ConformanceEnv | undefined;

export function getConformanceEnv(): ConformanceEnv {
  if (cached) return cached;

  const baseUrl = process.env.CONFORMANCE_BASE_URL;
  const token = process.env.CONFORMANCE_TOKEN;

  if (!baseUrl || !token) {
    throw new Error(
      'CONFORMANCE_BASE_URL and CONFORMANCE_TOKEN must be set. Run this suite via the ' +
        'softbinding-api-conformance CLI (--base-url / --token), or export both env vars ' +
        'yourself before calling `jest --config jest.conformance.config.js`.',
    );
  }

  cached = {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token,
    cleanup: process.env.CONFORMANCE_CLEANUP !== 'false',
  };
  return cached;
}

/** Test-only: clears the memoized env so tests can exercise different values. */
export function resetConformanceEnvForTests(): void {
  cached = undefined;
}
