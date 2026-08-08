import { api } from '../src/client';
import { fetchWellKnown } from '../src/discovery';
import { getConformanceEnv } from '../src/env';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

describe('service discovery endpoints', () => {
  it('GET /services/capabilities returns a spec version and capability list', async () => {
    const res = await api().get('/services/capabilities');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.supportedCapabilities)).toBe(true);
    if (res.body.c2paSpecificationVersion) {
      expect(res.body.c2paSpecificationVersion).toMatch(SEMVER_RE);
    }
  });

  it('GET /services/status returns a known status value', async () => {
    const res = await api().get('/services/status');

    expect(res.status).toBe(200);
    expect(['ok', 'degraded', 'down']).toContain(res.body.status);
  });

  it('GET /services/supportedAlgorithms returns watermark/fingerprint arrays', async () => {
    const res = await api().get('/services/supportedAlgorithms');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.watermarks)).toBe(true);
    expect(Array.isArray(res.body.fingerprints)).toBe(true);
  });

  it('GET /.well-known/c2pa-soft-binding-resolution returns the discovery document', async () => {
    const wellKnown = await fetchWellKnown(getConformanceEnv().baseUrl);

    if (!wellKnown) {
      console.warn(
        '[conformance] No well-known discovery document found at the domain root. This is ' +
          'new in spec v2.4.0 — acceptable for older implementations, but recommended.',
      );
      return;
    }

    expect(typeof wellKnown.apiEndpoint).toBe('string');
    expect(wellKnown.c2paSpecificationVersion).toMatch(SEMVER_RE);
  });
});
