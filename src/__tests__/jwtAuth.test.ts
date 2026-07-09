import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createJwtAuthMiddleware,
  createOptionalJwtAuthMiddleware,
  requireAuthScope,
} from '../auth';

const ISSUER = 'https://issuer.example.com/';
const AUDIENCE = 'my-audience';
const KID = 'test-key';

describe('createJwtAuthMiddleware', () => {
  let jwksServer: http.Server;
  let jwksUri: string;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let app: express.Express;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = KID;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    jwksServer = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });

    await new Promise<void>((resolve) => jwksServer.listen(0, resolve));
    const { port } = jwksServer.address() as AddressInfo;
    jwksUri = `http://127.0.0.1:${port}/jwks.json`;

    const middleware = createJwtAuthMiddleware({ issuer: ISSUER, audience: AUDIENCE, jwksUri });
    const optionalMiddleware = createOptionalJwtAuthMiddleware({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri,
    });
    app = express();
    app.get('/protected', middleware, (_req, res) => res.json({ ok: true }));
    app.get('/fetch', middleware, requireAuthScope('fetch:manifests'), (_req, res) =>
      res.json({ ok: true }),
    );
    app.get('/optional', optionalMiddleware, (_req, res) =>
      res.json({ context: res.locals.c2paAuthContext ?? null }),
    );
  });

  afterAll(() => {
    jwksServer.close();
  });

  function signToken(
    overrides: {
      issuer?: string;
      audience?: string;
      expSecondsFromNow?: number;
      scope?: string;
      scp?: string | string[];
    } = {},
  ) {
    const {
      issuer = ISSUER,
      audience = AUDIENCE,
      expSecondsFromNow = 3600,
      scope,
      scp,
    } = overrides;
    return new SignJWT({
      ...(scope === undefined ? {} : { scope }),
      ...(scp === undefined ? {} : { scp }),
    })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
      .sign(privateKey);
  }

  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authorization required' });
  });

  it('returns 401 for a non-Bearer Authorization header', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authorization required' });
  });

  it('allows the request through with a valid token', async () => {
    const token = await signToken();

    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows a scoped route when scope contains the required value', async () => {
    const token = await signToken({ scope: 'openid fetch:manifests' });

    const res = await request(app).get('/fetch').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('accepts an scp array claim', async () => {
    const token = await signToken({ scp: ['fetch:manifests'] });

    const res = await request(app).get('/fetch').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('returns 403 when a valid token has no required scope', async () => {
    const token = await signToken({ scope: 'store:bindings' });

    const res = await request(app).get('/fetch').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Missing required scope: fetch:manifests' });
  });

  it('returns 401 with "Token expired" for an expired token', async () => {
    const token = await signToken({ expSecondsFromNow: -10 });

    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token expired' });
  });

  it('returns 401 with "Invalid token" for a token with the wrong issuer', async () => {
    const token = await signToken({ issuer: 'https://wrong-issuer.example.com/' });

    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('returns 401 with "Invalid token" for a token with the wrong audience', async () => {
    const token = await signToken({ audience: 'wrong-audience' });

    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('returns 401 with "Invalid token" for a malformed token', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  describe('createOptionalJwtAuthMiddleware', () => {
    it('succeeds with no context when there is no Authorization header', async () => {
      const res = await request(app).get('/optional');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ context: null });
    });

    it('succeeds with no context for an invalid token, rather than rejecting', async () => {
      const res = await request(app).get('/optional').set('Authorization', 'Bearer not-a-jwt');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ context: null });
    });

    it('populates the auth context for a valid token', async () => {
      const token = await signToken({ scope: 'fetch:manifests' });

      const res = await request(app).get('/optional').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.context.scopes).toEqual(['fetch:manifests']);
    });
  });
});
