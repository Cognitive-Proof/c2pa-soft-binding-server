import Redis from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { RateLimitStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import type { Store } from 'express-rate-limit';

export interface RedisRateLimitOptions {
  /** Redis connection string. Default: REDIS_URL env var, else 'redis://localhost:6379'. */
  url?: string;
  /** Prefix for rate limit keys stored in Redis. Default: 'rl:'. */
  prefix?: string;
}

const createRedisRateLimitStore: RateLimitStorePlugin<RedisRateLimitOptions | undefined> = (
  options,
): Store => {
  const url = options?.url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new Redis(url);

  return new RedisStore({
    prefix: options?.prefix ?? 'rl:',
    sendCommand: (...args: string[]) =>
      client.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  });
};

export default createRedisRateLimitStore;
