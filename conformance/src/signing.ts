import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Shipped at the package root next to dist/ and src/, so the same relative
// path works from either.
const SIGNER = path.join(__dirname, '..', 'sign-manifest.mjs');

/**
 * Signs a fresh C2PA Manifest Store (sidecar, `application/c2pa`) titled
 * `title`, using the c2pa-rs sample test certificate. Each call yields a new
 * active manifest label, so stores that derive the manifest id from the
 * manifest itself see a different id every time.
 */
export async function signTestManifest(title: string): Promise<Buffer> {
  // --experimental-wasm-modules lets Node versions that still gate
  // WebAssembly ES module imports load the library; newer ones accept it too.
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--experimental-wasm-modules', '--no-warnings', SIGNER, title],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return Buffer.from(stdout, 'base64');
}
