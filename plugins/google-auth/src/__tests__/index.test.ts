import type { Request, Response, NextFunction } from 'express';

class JWTExpired extends Error {}
class JWTInvalid extends Error {}

const jwksRef = {};
const createRemoteJWKSetMock = jest.fn((..._args: unknown[]) => jwksRef);
const jwtVerifyMock = jest.fn((..._args: unknown[]) => Promise.resolve({ payload: {} }));

jest.mock('jose', () => ({
  createRemoteJWKSet: (...args: [unknown]) => createRemoteJWKSetMock(...args),
  jwtVerify: (...args: [unknown, unknown, unknown]) => jwtVerifyMock(...args),
  errors: { JWTExpired, JWTInvalid },
}));

import createGoogleAuthMiddleware from '../index';

function createMockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('createGoogleAuthMiddleware', () => {
  beforeEach(() => {
    createRemoteJWKSetMock.mockClear();
    jwtVerifyMock.mockReset();
  });

  it('configures the JWKS, issuer, and audience for the given GCP project', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: {} });
    const middleware = createGoogleAuthMiddleware('my-project');

    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      ),
    );

    const req = { headers: { authorization: 'Bearer token123' } } as Request;
    const res = createMockRes();
    const next = jest.fn();

    await middleware(req, res, next as NextFunction);

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'token123',
      jwksRef,
      expect.objectContaining({
        issuer: 'https://securetoken.google.com/my-project',
        audience: 'my-project',
      }),
    );
  });

  it('returns 401 when no Authorization header is present', async () => {
    const middleware = createGoogleAuthMiddleware('my-project');
    const req = { headers: {} } as Request;
    const res = createMockRes();
    const next = jest.fn();

    await middleware(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authorization required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is not a Bearer token', async () => {
    const middleware = createGoogleAuthMiddleware('my-project');
    const req = { headers: { authorization: 'Basic abc123' } } as Request;
    const res = createMockRes();
    const next = jest.fn();

    await middleware(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authorization required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the token is valid', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: {} });
    const middleware = createGoogleAuthMiddleware('my-project');
    const req = { headers: { authorization: 'Bearer valid-token' } } as Request;
    const res = createMockRes();
    const next = jest.fn();

    await middleware(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 "Token expired" when jose throws JWTExpired', async () => {
    jwtVerifyMock.mockRejectedValue(new JWTExpired('expired'));
    const middleware = createGoogleAuthMiddleware('my-project');
    const req = { headers: { authorization: 'Bearer expired-token' } } as Request;
    const res = createMockRes();
    const next = jest.fn();

    await middleware(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "Invalid token" for other verification failures', async () => {
    jwtVerifyMock.mockRejectedValue(new JWTInvalid('bad signature'));
    const middleware = createGoogleAuthMiddleware('my-project');
    const req = { headers: { authorization: 'Bearer bad-token' } } as Request;
    const res = createMockRes();
    const next = jest.fn();

    await middleware(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });
});
