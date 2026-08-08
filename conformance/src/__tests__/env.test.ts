import { getConformanceEnv, resetConformanceEnvForTests } from '../env';

describe('getConformanceEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConformanceEnvForTests();
  });

  it('throws a descriptive error when required env vars are missing', () => {
    delete process.env.CONFORMANCE_BASE_URL;
    delete process.env.CONFORMANCE_TOKEN;

    expect(() => getConformanceEnv()).toThrow(/CONFORMANCE_BASE_URL/);
  });

  it('strips a trailing slash from the base URL', () => {
    process.env.CONFORMANCE_BASE_URL = 'https://example.com/v1/';
    process.env.CONFORMANCE_TOKEN = 'test-token';

    expect(getConformanceEnv().baseUrl).toBe('https://example.com/v1');
  });

  it('defaults cleanup to true, and honors CONFORMANCE_CLEANUP=false', () => {
    process.env.CONFORMANCE_BASE_URL = 'https://example.com/v1';
    process.env.CONFORMANCE_TOKEN = 'test-token';
    expect(getConformanceEnv().cleanup).toBe(true);

    resetConformanceEnvForTests();
    process.env.CONFORMANCE_CLEANUP = 'false';
    expect(getConformanceEnv().cleanup).toBe(false);
  });

  it('memoizes after the first call', () => {
    process.env.CONFORMANCE_BASE_URL = 'https://example.com/v1';
    process.env.CONFORMANCE_TOKEN = 'test-token';
    const first = getConformanceEnv();

    process.env.CONFORMANCE_BASE_URL = 'https://changed.example.com/v1';
    const second = getConformanceEnv();

    expect(second).toBe(first);
    expect(second.baseUrl).toBe('https://example.com/v1');
  });
});
