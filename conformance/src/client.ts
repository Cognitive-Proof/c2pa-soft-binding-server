import request from 'supertest';
import { getConformanceEnv } from './env';

/**
 * A supertest agent pointed at the target's base URL. Works identically to
 * `supertest(app)` in the server's own white-box tests — supertest's
 * underlying superagent client makes real HTTP requests either way, so the
 * exact same request-building/assertion style carries over.
 */
export function api(): ReturnType<typeof request> {
  return request(getConformanceEnv().baseUrl);
}

/** Header object for the configured bearer token: `.set(authHeader())`. */
export function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${getConformanceEnv().token}` };
}
