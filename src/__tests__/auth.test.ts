import express, { type RequestHandler } from 'express';
import request from 'supertest';
import type { Logger } from '@cognitiveproof/softbinding-api-plugin-types';
import { requireAuthScope, resolveAuthMiddleware, resolveOptionalAuthMiddleware } from '../auth';

function createFakeLogger(): Logger {
  const logger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => logger),
  };
  return logger;
}

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
  it('returns a custom RequestHandler as-is', () => {
    const custom: RequestHandler = (_req, _res, next) => next();

    expect(resolveAuthMiddleware(custom, createFakeLogger())).toBe(custom);
  });

  it('builds a JWT middleware from JwtAuthOptions', () => {
    const middleware = resolveAuthMiddleware(
      {
        issuer: 'https://issuer.example.com/',
        audience: 'my-audience',
        jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
      },
      createFakeLogger(),
    );

    expect(typeof middleware).toBe('function');
  });

  it('allows every request through and logs a warning when auth is omitted', async () => {
    const logger = createFakeLogger();
    const middleware = resolveAuthMiddleware(undefined, logger);

    const app = express();
    app.get('/', middleware, requireAuthScope('store:manifests'), (_req, res) =>
      res.sendStatus(204),
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/`auth` is not configured/));
  });
});

describe('resolveOptionalAuthMiddleware', () => {
  it('never invokes a custom auth function, always leaving auth context unset', async () => {
    const custom = jest.fn<void, Parameters<RequestHandler>>((_req, res, next) => {
      res.locals.c2paAuthContext = { scopes: ['fetch:manifests'], claims: {} };
      next();
    });

    const middleware = resolveOptionalAuthMiddleware(custom);
    const app = express();
    app.get('/', middleware, (_req, res) =>
      res.json({ context: res.locals.c2paAuthContext ?? null }),
    );

    const res = await request(app).get('/');

    expect(res.body).toEqual({ context: null });
    expect(custom).not.toHaveBeenCalled();
  });

  it('builds an optional JWT middleware from JwtAuthOptions', () => {
    const middleware = resolveOptionalAuthMiddleware({
      issuer: 'https://issuer.example.com/',
      audience: 'my-audience',
      jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
    });

    expect(typeof middleware).toBe('function');
  });

  it('falls back to an always-anonymous middleware when auth is omitted', async () => {
    const middleware = resolveOptionalAuthMiddleware(undefined);
    const app = express();
    app.get('/', middleware, (_req, res) =>
      res.json({ context: res.locals.c2paAuthContext ?? null }),
    );

    const res = await request(app).get('/').set('Authorization', 'Bearer anything');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ context: null });
  });
});
