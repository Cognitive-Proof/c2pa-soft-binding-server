import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { requireAuthScope, resolveAuthMiddleware, resolveOptionalAuthMiddleware } from '../auth';

describe('requireAuthScope', () => {
  it('allows a request with the required scope', async () => {
    const app = express();
    app.get(
      '/',
      (_req, res, next) => {
        res.locals.c2paAuthScopes = ['fetch:manifests'];
        next();
      },
      requireAuthScope('fetch:manifests'),
      (_req, res) => res.sendStatus(204),
    );

    expect((await request(app).get('/')).status).toBe(204);
  });

  it('returns 403 when the authenticated request lacks the required scope', async () => {
    const app = express();
    app.get(
      '/',
      (_req, res, next) => {
        res.locals.c2paAuthScopes = ['fetch:manifests'];
        next();
      },
      requireAuthScope('store:bindings'),
      (_req, res) => res.sendStatus(204),
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Missing required scope: store:bindings' });
  });

  it('leaves authorization to custom middleware that does not publish scopes', async () => {
    const app = express();
    app.get('/', requireAuthScope('store:manifests'), (_req, res) => res.sendStatus(204));

    expect((await request(app).get('/')).status).toBe(204);
  });
});

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

describe('resolveOptionalAuthMiddleware', () => {
  const ENV = process.env;

  beforeEach(() => {
    process.env = { ...ENV };
  });

  afterAll(() => {
    process.env = ENV;
  });

  it('never invokes a custom auth function, always leaving auth context unset', async () => {
    const custom = jest.fn<void, Parameters<RequestHandler>>((_req, res, next) => {
      res.locals.c2paAuthContext = { scopes: ['fetch:manifests'], claims: {} };
      next();
    });

    const middleware = resolveOptionalAuthMiddleware(custom, undefined);
    const app = express();
    app.get('/', middleware, (_req, res) =>
      res.json({ context: res.locals.c2paAuthContext ?? null }),
    );

    const res = await request(app).get('/');

    expect(res.body).toEqual({ context: null });
    expect(custom).not.toHaveBeenCalled();
  });

  it('builds an optional JWT middleware from JwtAuthOptions', () => {
    const middleware = resolveOptionalAuthMiddleware(
      {
        issuer: 'https://issuer.example.com/',
        audience: 'my-audience',
        jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
      },
      'some-gcp-project',
    );

    expect(typeof middleware).toBe('function');
  });

  it("falls back to the default plugin package's optional export", () => {
    delete process.env.SKIP_ENV_VALIDATION;

    const middleware = resolveOptionalAuthMiddleware(undefined, 'my-gcp-project');

    expect(typeof middleware).toBe('function');
  });

  it('falls back to an always-anonymous middleware when AUTH_PLUGIN has no optional export', async () => {
    process.env.AUTH_PLUGIN = '@cognitiveproof/does-not-exist';

    const middleware = resolveOptionalAuthMiddleware(undefined, 'my-gcp-project');
    const app = express();
    app.get('/', middleware, (_req, res) =>
      res.json({ context: res.locals.c2paAuthContext ?? null }),
    );

    const res = await request(app).get('/').set('Authorization', 'Bearer anything');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ context: null });
  });
});
