import http from 'http';
import type { AddressInfo } from 'net';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import createServiceAccountAuthMiddleware, { serviceAccountAuthOptionsFromEnv } from '../index';

const AUDIENCE = 'https://softbinding.example';
const SIGNER = 'c2pa-signer@project.iam.gserviceaccount.com';
const SIGNER_SCOPES = ['store:manifests', 'store:bindings', 'store:originals', 'fetch:manifests'];
const KID = 'test-key';

// Mirrors the server's requireAuthScope(): reads the scopes the auth
// middleware placed on res.locals.c2paAuthScopes.
function requireScope(scope: string): RequestHandler {
  return (_req, res, next) => {
    const scopes = res.locals.c2paAuthScopes as unknown;
    if (Array.isArray(scopes) && scopes.includes(scope)) return next();
    res.status(403).json({ error: `Missing required scope: ${scope}` });
  };
}

describe('createServiceAccountAuthMiddleware', () => {
  let jwksServer: http.Server;
  let jwksUri: string;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: KID, alg: 'RS256' };

    jwksServer = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, resolve));
    const { port } = jwksServer.address() as AddressInfo;
    jwksUri = `http://127.0.0.1:${port}/certs`;
  });

  afterAll(() => {
    jwksServer.close();
  });

  function signToken(
    claims: Record<string, unknown> = {},
    opts: { issuer?: string; audience?: string; expiresIn?: string | number } = {},
  ) {
    return new SignJWT({ email: SIGNER, email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(opts.issuer ?? 'https://accounts.google.com')
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey);
  }

  function buildApp(
    overrides: { fallback?: RequestHandler; accounts?: Record<string, string[]> } = {},
  ) {
    const auth = createServiceAccountAuthMiddleware({
      audience: AUDIENCE,
      accounts: {
        [SIGNER]: SIGNER_SCOPES,
        'reader@project.iam.gserviceaccount.com': ['fetch:manifests'],
      },
      jwksUri,
      ...overrides,
    });
    const app = express();
    app.get('/whoami', auth, (_req, res) => res.json({ scopes: res.locals.c2paAuthScopes }));
    app.post('/manifests', auth, requireScope('store:manifests'), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  it('accepts an allowlisted service account and grants its scopes', async () => {
    const res = await request(buildApp())
      .get('/whoami')
      .set('Authorization', `Bearer ${await signToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scopes: SIGNER_SCOPES });
  });

  it('accepts the bare accounts.google.com issuer', async () => {
    const token = await signToken({}, { issuer: 'accounts.google.com' });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('returns 401 when no bearer token is sent', async () => {
    const res = await request(buildApp()).get('/whoami');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authorization required' });
  });

  it('returns 401 for the wrong audience', async () => {
    const token = await signToken({}, { audience: 'https://other-service.example' });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('returns 401 for the wrong issuer', async () => {
    const token = await signToken({}, { issuer: 'https://securetoken.google.com/project' });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('returns 401 "Token expired" for an expired token', async () => {
    const token = await signToken({}, { expiresIn: Math.floor(Date.now() / 1000) - 600 });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token expired' });
  });

  it('returns 401 for a token signed by an unknown key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({ email: SIGNER, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://accounts.google.com')
      .setAudience(AUDIENCE)
      .setExpirationTime('1h')
      .sign(otherKey);

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('returns 403 for a service account that is not allowlisted', async () => {
    const token = await signToken({ email: 'someone-else@other.iam.gserviceaccount.com' });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Caller is not an allowed service account' });
  });

  it('returns 403 when email_verified is not true', async () => {
    const token = await signToken({ email_verified: false });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 for an email matching an Object.prototype key', async () => {
    const token = await signToken({ email: 'constructor' });

    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 on a store route when the account lacks the scope', async () => {
    const token = await signToken({ email: 'reader@project.iam.gserviceaccount.com' });

    const res = await request(buildApp())
      .post('/manifests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Missing required scope: store:manifests' });
  });

  it('allows a store route when the account has the scope', async () => {
    const res = await request(buildApp())
      .post('/manifests')
      .set('Authorization', `Bearer ${await signToken()}`);

    expect(res.status).toBe(200);
  });

  describe('with a fallback', () => {
    const fallback: RequestHandler = (_req, res) => {
      res.status(418).json({ handledBy: 'fallback' });
    };

    it('delegates non-Google-issued tokens to the fallback', async () => {
      const token = await signToken({}, { issuer: 'https://securetoken.google.com/project' });

      const res = await request(buildApp({ fallback }))
        .get('/whoami')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(418);
    });

    it('delegates requests without a bearer token to the fallback', async () => {
      const res = await request(buildApp({ fallback })).get('/whoami');

      expect(res.status).toBe(418);
    });

    it('still verifies Google-issued tokens itself', async () => {
      const token = await signToken({}, { audience: 'https://other-service.example' });

      const res = await request(buildApp({ fallback }))
        .get('/whoami')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });
  });

  it('requires an audience', () => {
    expect(() => createServiceAccountAuthMiddleware({ audience: '', accounts: {} })).toThrow(
      /audience/,
    );
  });
});

describe('serviceAccountAuthOptionsFromEnv', () => {
  it('returns undefined when SA_AUTH_ACCOUNTS is unset', () => {
    expect(serviceAccountAuthOptionsFromEnv({})).toBeUndefined();
  });

  it('parses the audience and allowlist', () => {
    expect(
      serviceAccountAuthOptionsFromEnv({
        SA_AUTH_AUDIENCE: AUDIENCE,
        SA_AUTH_ACCOUNTS: JSON.stringify({ [SIGNER]: SIGNER_SCOPES }),
      }),
    ).toEqual({ audience: AUDIENCE, accounts: { [SIGNER]: SIGNER_SCOPES } });
  });

  it('requires SA_AUTH_AUDIENCE alongside SA_AUTH_ACCOUNTS', () => {
    expect(() => serviceAccountAuthOptionsFromEnv({ SA_AUTH_ACCOUNTS: '{}' })).toThrow(
      /SA_AUTH_AUDIENCE/,
    );
  });

  it.each(['not json', '[]', '{"a@b":"store:manifests"}'])(
    'rejects SA_AUTH_ACCOUNTS=%s',
    (value) => {
      expect(() =>
        serviceAccountAuthOptionsFromEnv({ SA_AUTH_AUDIENCE: AUDIENCE, SA_AUTH_ACCOUNTS: value }),
      ).toThrow(/SA_AUTH_ACCOUNTS/);
    },
  );
});
