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
 * Fetches `GET {baseUrl}/services/capabilities`, or returns `undefined` if the
 * target doesn't serve it. The endpoint is not in the published 2.4 spec, so
 * a missing one usually means a 2.4 target rather than a broken one.
 */
export async function probeCapabilities(baseUrl: string): Promise<Capabilities | undefined> {
  try {
    const res = await request(baseUrl).get('/services/capabilities');
    if (res.status === 200 && Array.isArray(res.body?.supportedCapabilities)) {
      return res.body as Capabilities;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** Every optional capability, for targets that can't report their own. */
export function assumeAllCapabilities(): Capabilities {
  return { supportedCapabilities: [...ALL_CAPABILITIES] };
}

/**
 * Fetches `GET {baseUrl}/services/capabilities`. Falls back to "assume every
 * optional capability is present" (with a warning) if the endpoint is
 * missing entirely — an older/partial implementation predating this
 * discovery endpoint shouldn't cause the whole suite to skip everything.
 */
export async function fetchCapabilities(baseUrl: string): Promise<Capabilities> {
  const capabilities = await probeCapabilities(baseUrl);
  if (capabilities) return capabilities;

  console.warn(
    '[conformance] GET /services/capabilities was not available on this target; assuming ' +
      'all optional endpoints are implemented. Discovery-based skipping is degraded — ' +
      'suites for endpoints this target does not actually implement will fail instead of skip.',
  );
  return assumeAllCapabilities();
}

/**
 * Fetches the well-known discovery document, which per RFC 8615 lives at the
 * domain root rather than under the versioned `/v1` API prefix `baseUrl`
 * points at. Returns `undefined` (not a throw) if it's missing, since it was
 * added after the published 2.4 spec and 2.4 implementations won't have it.
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

/**
 * Whether the target serves the discovery endpoints added after the published
 * 2.4 spec (`/services/capabilities`, `/services/status` and the well-known
 * document). `cli.ts` sets `CONFORMANCE_DISCOVERY=false` when
 * `/services/capabilities` is missing; without the CLI, assume they exist.
 */
export function hasDiscoveryEndpoints(): boolean {
  return process.env.CONFORMANCE_DISCOVERY !== 'false';
}
