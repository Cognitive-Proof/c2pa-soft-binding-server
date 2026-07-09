import { readFileSync } from 'fs';
import { resolve } from 'path';

interface UploadEnvironment {
  SERVER_URL: string;
  AUTH_TOKEN?: string;
  RETURN_RECEIPT?: boolean;
}

function loadEnvironment(): UploadEnvironment {
  const envPath = resolve(__dirname, 'enviroment.json');
  const raw = readFileSync(envPath, 'utf-8');
  return JSON.parse(raw) as UploadEnvironment;
}

async function uploadManifest(manifestPath: string): Promise<void> {
  const env = loadEnvironment();
  const manifest = readFileSync(resolve(manifestPath));

  const url = new URL('/v1/manifests', env.SERVER_URL);
  if (env.RETURN_RECEIPT) {
    url.searchParams.set('returnReceipt', 'true');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/c2pa',
  };
  if (env.AUTH_TOKEN) {
    headers.Authorization = `Bearer ${env.AUTH_TOKEN}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: manifest,
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}: ${body}`);
  }

  console.log(body);
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: upload:manifest <path-to-manifest-file>');
  process.exit(1);
}

uploadManifest(manifestPath).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
