import type { RequestHandler } from 'express';
import { resolveAuthMiddleware } from '../auth';

describe('resolveAuthMiddleware', () => {
  const ENV = process.env;

  beforeEach(() => {
    process.env = { ...ENV };
  });

  afterAll(() => {
    process.env = ENV;
  });

  it('returns a custom RequestHandler as-is', () => {
    const custom: RequestHandler = (_req, _res, next) => next();

    expect(resolveAuthMiddleware(custom, undefined)).toBe(custom);
  });

  it('builds a JWT middleware from JwtAuthOptions, ignoring gcpProjectId', () => {
    const middleware = resolveAuthMiddleware(
      {
        issuer: 'https://issuer.example.com/',
        audience: 'my-audience',
        jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
      },
      'some-gcp-project',
    );

    expect(typeof middleware).toBe('function');
  });

  it('throws when neither auth nor gcpProjectId/GCP_PROJECT_ID is provided', () => {
    delete process.env.SKIP_ENV_VALIDATION;
    delete process.env.GCP_PROJECT_ID;

    expect(() => resolveAuthMiddleware(undefined, undefined)).toThrow(
      /Missing required configuration/,
    );
  });

  it('falls back to the default auth plugin when SKIP_ENV_VALIDATION is set', () => {
    process.env.SKIP_ENV_VALIDATION = '1';
    delete process.env.GCP_PROJECT_ID;

    const middleware = resolveAuthMiddleware(undefined, undefined);

    expect(typeof middleware).toBe('function');
  });

  it('falls back to the default auth plugin when gcpProjectId is provided', () => {
    delete process.env.SKIP_ENV_VALIDATION;

    const middleware = resolveAuthMiddleware(undefined, 'my-gcp-project');

    expect(typeof middleware).toBe('function');
  });

  it('throws a helpful error when AUTH_PLUGIN points at a missing package', () => {
    process.env.AUTH_PLUGIN = '@cognitiveproof/does-not-exist';

    expect(() => resolveAuthMiddleware(undefined, 'my-gcp-project')).toThrow(
      'Auth plugin "@cognitiveproof/does-not-exist" is not installed. Run `npm install @cognitiveproof/does-not-exist`.',
    );
  });
});
