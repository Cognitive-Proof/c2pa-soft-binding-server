import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createJwtAuthMiddleware } from '../auth';

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

    await new Promise<void>(resolve => jwksServer.listen(0, resolve));
    const { port } = jwksServer.address() as AddressInfo;
    jwksUri = `http://127.0.0.1:${port}/jwks.json`;

    const middleware = createJwtAuthMiddleware({ issuer: ISSUER, audience: AUDIENCE, jwksUri });
    app = express();
    app.get('/protected', middleware, (_req, res) => res.json({ ok: true }));
  });

  afterAll(() => {
    jwksServer.close();
  });

  function signToken(overrides: { issuer?: string; audience?: string; expSecondsFromNow?: number } = {}) {
    const { issuer = ISSUER, audience = AUDIENCE, expSecondsFromNow = 3600 } = overrides;
    return new SignJWT({})
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
});
