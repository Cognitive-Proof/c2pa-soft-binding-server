// Resolves the express-rate-limit Store used to share rate limit counters
// across server instances: either a Store instance passed directly, or an
// npm package name to require() — falling back to RATELIMIT_STORE_PLUGIN. If
// none is configured, express-rate-limit's default in-memory store is used
// (per-process, not shared across instances).

import type { Store } from 'express-rate-limit';
import type { RateLimitStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';

function loadRateLimitStorePlugin(packageName: string): RateLimitStorePlugin<unknown> {
  try {
    return (require(packageName) as { default: RateLimitStorePlugin<unknown> }).default;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `RateLimit store plugin "${packageName}" is not installed. Run \`npm install ${packageName}\`.`,
        { cause: err },
      );
    }
    throw err;
  }
}

export function resolveRateLimitStore(store?: Store | string): Store | undefined {
  if (store && typeof store === 'object') return store;

  const packageName = store ?? process.env.RATELIMIT_STORE_PLUGIN;
  if (!packageName) return undefined;

  return loadRateLimitStorePlugin(packageName)(undefined);
}
