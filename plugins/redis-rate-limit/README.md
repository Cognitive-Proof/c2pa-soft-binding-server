# @cognitiveproof/softbinding-api-plugin-redis-rate-limit

Redis-backed `RateLimitStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

`createServer()` rate-limits `/v1` routes via [`express-rate-limit`](https://express-rate-limit.mintlify.app/), which by default tracks counters in-memory — fine for a single instance, but each replica tracks its own counters separately. This plugin provides a shared [`rate-limit-redis`](https://github.com/express-rate-limit/rate-limit-redis) store (backed by [`ioredis`](https://github.com/redis/ioredis)) so multiple server instances/replicas share the same rate limit counters.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-redis-rate-limit
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  rateLimitStore: '@cognitiveproof/softbinding-api-plugin-redis-rate-limit',
});
```

Or pass the package name via the `RATELIMIT_STORE_PLUGIN` environment variable and omit the `rateLimitStore` option entirely.

To pass options (instead of relying on `REDIS_URL`), import and call the plugin directly:

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';
import createRedisRateLimitStore from '@cognitiveproof/softbinding-api-plugin-redis-rate-limit';

const app = createServer({
  rateLimitStore: createRedisRateLimitStore({
    url: 'redis://my-redis:6379',
    prefix: 'softbinding-rl:',
  }),
});
```

## Configuration

| Option   | Env var     | Default                  | Description                                |
| -------- | ----------- | ------------------------ | ------------------------------------------ |
| `url`    | `REDIS_URL` | `redis://localhost:6379` | Redis connection string                    |
| `prefix` | —           | `rl:`                    | Prefix for rate limit keys stored in Redis |

## License

[MIT](LICENSE)
