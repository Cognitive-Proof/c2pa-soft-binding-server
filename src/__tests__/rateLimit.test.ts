import { resolveRateLimitStore } from '../rateLimit';
import type { Store } from 'express-rate-limit';

describe('resolveRateLimitStore', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RATELIMIT_STORE_PLUGIN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a Store instance as-is', () => {
    const custom = {} as Store;

    expect(resolveRateLimitStore(custom)).toBe(custom);
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveRateLimitStore()).toBeUndefined();
  });

  it('throws a helpful error when RATELIMIT_STORE_PLUGIN points at a missing package', () => {
    process.env.RATELIMIT_STORE_PLUGIN = '@cognitiveproof/does-not-exist';

    expect(() => resolveRateLimitStore()).toThrow(
      'RateLimit store plugin "@cognitiveproof/does-not-exist" is not installed. Run `npm install @cognitiveproof/does-not-exist`.',
    );
  });

  it('throws a helpful error when the package name option is missing', () => {
    expect(() => resolveRateLimitStore('@cognitiveproof/does-not-exist')).toThrow(
      'RateLimit store plugin "@cognitiveproof/does-not-exist" is not installed. Run `npm install @cognitiveproof/does-not-exist`.',
    );
  });
});
