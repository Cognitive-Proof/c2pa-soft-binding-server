import { resolveConfig } from '../config';

describe('resolveConfig', () => {
  const ENV = process.env;

  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.REPO_URI;
    delete process.env.RECEIPT_SECRET;
    delete process.env.MAX_UPLOAD_SIZE;
    delete process.env.MAX_REFERENCE_SIZE;
  });

  afterAll(() => {
    process.env = ENV;
  });

  it('applies defaults when no options or env vars are set', () => {
    const config = resolveConfig();

    expect(config.repoUri).toBe('http://localhost:3000');
    expect(config.maxUploadSize).toBe(52428800);
    expect(config.maxReferenceSize).toBe(104857600);
    expect(config.docs).toBe(true);
    expect(typeof config.receiptSecret).toBe('string');
    expect(config.receiptSecret.length).toBeGreaterThan(0);
  });

  it('prefers explicit options over env vars and defaults', () => {
    process.env.REPO_URI = 'https://from-env.example.com';

    const config = resolveConfig({
      repoUri: 'https://from-options.example.com',
      receiptSecret: 'my-secret',
      maxUploadSize: 1234,
      maxReferenceSize: 5678,
      docs: false,
    });

    expect(config.repoUri).toBe('https://from-options.example.com');
    expect(config.receiptSecret).toBe('my-secret');
    expect(config.maxUploadSize).toBe(1234);
    expect(config.maxReferenceSize).toBe(5678);
    expect(config.docs).toBe(false);
  });

  it('falls back to env vars when options are not provided', () => {
    process.env.REPO_URI = 'https://from-env.example.com';
    process.env.RECEIPT_SECRET = 'env-secret';
    process.env.MAX_UPLOAD_SIZE = '111';
    process.env.MAX_REFERENCE_SIZE = '222';

    const config = resolveConfig();

    expect(config.repoUri).toBe('https://from-env.example.com');
    expect(config.receiptSecret).toBe('env-secret');
    expect(config.maxUploadSize).toBe(111);
    expect(config.maxReferenceSize).toBe(222);
  });

  it('generates a different random receiptSecret on each call when unset', () => {
    const a = resolveConfig();
    const b = resolveConfig();

    expect(a.receiptSecret).not.toBe(b.receiptSecret);
  });
});
