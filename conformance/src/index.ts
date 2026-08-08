// Library entry point. Most users should run the `softbinding-api-conformance`
// CLI instead — these exports exist for programmatic use (e.g. driving the
// discovery/fixture logic from a custom script).
export { getConformanceEnv, resetConformanceEnvForTests, type ConformanceEnv } from './env';
export { api, authHeader } from './client';
export {
  fetchCapabilities,
  fetchWellKnown,
  getCachedCapabilities,
  hasCapability,
  type Capabilities,
  type WellKnownDiscovery,
} from './discovery';
export { createTestManifest, cleanupAll, markerPayload, type TestManifest } from './fixtures';
