// Registered per test file via setupFilesAfterEnv, so each conformance test
// file's own fixture manifests get cleaned up after that file's tests run
// (Jest isolates the module registry per test file, so fixtures.ts's
// in-memory registry is naturally scoped to one file already).
import { cleanupAll } from './src/fixtures';

afterAll(async () => {
  await cleanupAll();
});
