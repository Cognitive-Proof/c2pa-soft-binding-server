import request from 'supertest';

export interface Capabilities {
  c2paSpecificationVersion?: string;
  supportedCapabilities: string[];
}

export interface WellKnownDiscovery {
  apiEndpoint: string;
  c2paSpecificationVersion: string;
  capabilitiesEndpoint?: string;
  statusEndpoint?: string;
}

const ALL_CAPABILITIES = ['queryByContent', 'queryByReference', 'storeManifests', 'storeBindings'];

/**
 * Fetches `GET {baseUrl}/services/capabilities`. Falls back to "assume every
 * optional capability is present" (with a warning) if the endpoint is
 * missing entirely — an older/partial implementation predating this
 * discovery endpoint shouldn't cause the whole suite to skip everything.
 */
export async function fetchCapabilities(baseUrl: string): Promise<Capabilities> {
  try {
    const res = await request(baseUrl).get('/services/capabilities');
    if (res.status === 200 && Array.isArray(res.body?.supportedCapabilities)) {
      return res.body as Capabilities;
    }
  } catch {
    // fall through to the degraded default below
  }

  console.warn(
    '[conformance] GET /services/capabilities was not available on this target; assuming ' +
      'all optional endpoints are implemented. Discovery-based skipping is degraded — ' +
      'suites for endpoints this target does not actually implement will fail instead of skip.',
  );
  return { supportedCapabilities: ALL_CAPABILITIES };
}

/**
 * Fetches the well-known discovery document, which per RFC 8615 lives at the
 * domain root rather than under the versioned `/v1` API prefix `baseUrl`
 * points at. Returns `undefined` (not a throw) if it's missing, since it's
 * new in spec v2.4.0 and older implementations won't have it.
 */
export async function fetchWellKnown(baseUrl: string): Promise<WellKnownDiscovery | undefined> {
  const origin = new URL(baseUrl).origin;
  try {
    const res = await request(origin).get('/.well-known/c2pa-soft-binding-resolution');
    if (res.status === 200) return res.body as WellKnownDiscovery;
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Reads capabilities discovered once up front by `cli.ts` (passed to the
 * Jest subprocess as `CONFORMANCE_CAPABILITIES`), so individual test files
 * can decide what to `describe.skip` synchronously rather than awaiting a
 * network call inside a `describe()` block. Falls back to "assume all
 * present" (with a warning) if the suite was invoked without going through
 * the CLI (e.g. `jest --config jest.conformance.config.js` directly).
 */
export function getCachedCapabilities(): Capabilities {
  const raw = process.env.CONFORMANCE_CAPABILITIES;
  if (!raw) {
    console.warn(
      '[conformance] CONFORMANCE_CAPABILITIES was not set (suite invoked without the CLI); ' +
        'assuming all optional endpoints are implemented.',
    );
    return { supportedCapabilities: ALL_CAPABILITIES };
  }
  return JSON.parse(raw) as Capabilities;
}

export function hasCapability(name: string): boolean {
  return getCachedCapabilities().supportedCapabilities.includes(name);
}
