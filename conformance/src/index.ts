// Library entry point. Most users should run the `softbinding-api-conformance`
// CLI instead — these exports exist for programmatic use (e.g. driving the
// discovery/fixture logic from a custom script).
export { getConformanceEnv, resetConformanceEnvForTests, type ConformanceEnv } from './env';
export { api, authHeader } from './client';
export {
  assumeAllCapabilities,
  fetchCapabilities,
  fetchWellKnown,
  getCachedCapabilities,
  hasCapability,
  hasDiscoveryEndpoints,
  probeCapabilities,
  type Capabilities,
  type WellKnownDiscovery,
} from './discovery';
export {
  createTestManifest,
  createTestManifestBytes,
  cleanupAll,
  markerPayload,
  trackForCleanup,
  type TestManifest,
} from './fixtures';
export { signTestManifest } from './signing';
