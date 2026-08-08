import { api } from '../src/client';
import { fetchWellKnown } from '../src/discovery';
import { getConformanceEnv } from '../src/env';

describe('services.supportedAlgorithms shape', () => {
  it('each algorithm entry has a non-empty "alg" string', async () => {
    const res = await api().get('/services/supportedAlgorithms');

    expect(res.status).toBe(200);
    for (const entry of [...(res.body.watermarks ?? []), ...(res.body.fingerprints ?? [])]) {
      expect(typeof entry.alg).toBe('string');
      expect(entry.alg.length).toBeGreaterThan(0);
    }
  });
});

describe('discovery endpoints agree with each other', () => {
  it('capabilities and well-known report the same c2paSpecificationVersion', async () => {
    const capabilities = await api().get('/services/capabilities');
    const wellKnown = await fetchWellKnown(getConformanceEnv().baseUrl);

    if (capabilities.status !== 200 || !wellKnown) {
      console.warn(
        '[conformance] Skipping cross-check: one of the two discovery endpoints is missing.',
      );
      return;
    }

    expect(wellKnown.c2paSpecificationVersion).toBe(capabilities.body.c2paSpecificationVersion);
  });
});
