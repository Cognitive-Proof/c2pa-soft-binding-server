import { readFileSync } from 'fs';
import { resolve } from 'path';

interface UploadEnvironment {
  SERVER_URL: string;
  AUTH_TOKEN?: string;
}

function loadEnvironment(): UploadEnvironment {
  const envPath = resolve(__dirname, 'enviroment.json');
  const raw = readFileSync(envPath, 'utf-8');
  return JSON.parse(raw) as UploadEnvironment;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;

  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function logLocalTokenInfo(token: string): void {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    console.log('Token does not look like a JWT (skipping local claim inspection).');
    return;
  }

  const { iss, aud, scope, scp, exp } = payload as Record<string, unknown>;
  console.log('Local token claims (unverified):');
  console.log(`  issuer:    ${iss ?? '(none)'}`);
  console.log(`  audience:  ${aud ?? '(none)'}`);
  console.log(`  scope:     ${scope ?? scp ?? '(none)'}`);

  if (typeof exp === 'number') {
    const expiresAt = new Date(exp * 1000);
    const expired = Date.now() >= exp * 1000;
    console.log(`  expires:   ${expiresAt.toISOString()}${expired ? ' (EXPIRED)' : ''}`);
  }
}

async function checkAuthToken(): Promise<void> {
  const env = loadEnvironment();

  if (!env.AUTH_TOKEN) {
    console.error('No AUTH_TOKEN set in scripts/enviroment.json.');
    process.exit(1);
  }

  logLocalTokenInfo(env.AUTH_TOKEN);

  // A lightweight authenticated endpoint: it only requires the `fetch:manifests`
  // scope and accepts a throwaway `value`, so it isolates auth/scope failures
  // (401/403) from data-not-found responses.
  const url = new URL('/v1/matches/byBinding', env.SERVER_URL);
  url.searchParams.set('value', 'auth-check');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AUTH_TOKEN}` },
  });

  console.log(`\nServer check: GET ${url.pathname}`);
  console.log(`  status: ${response.status}`);

  if (response.status === 401) {
    console.error('  Token was rejected: missing, invalid, or expired.');
    process.exit(1);
  }

  if (response.status === 403) {
    console.error('  Token is valid but lacks the required scope (fetch:manifests).');
    process.exit(1);
  }

  console.log('  Token was accepted by the server.');
}

checkAuthToken().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
