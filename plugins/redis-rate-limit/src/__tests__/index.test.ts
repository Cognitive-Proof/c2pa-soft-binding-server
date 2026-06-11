const redisCallMock = jest.fn((..._args: unknown[]) => Promise.resolve('OK'));
const RedisMock = jest.fn().mockImplementation((..._args: unknown[]) => ({
  call: redisCallMock,
}));

const RedisStoreMock = jest.fn().mockImplementation((options: unknown) => ({
  __isRedisStore: true,
  options,
}));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: RedisMock,
}));

jest.mock('rate-limit-redis', () => ({
  RedisStore: RedisStoreMock,
}));

import createRedisRateLimitStore from '../index';

describe('createRedisRateLimitStore', () => {
  beforeEach(() => {
    RedisMock.mockClear();
    RedisStoreMock.mockClear();
    delete process.env.REDIS_URL;
  });

  it('connects to REDIS_URL and uses the default "rl:" prefix when no options are given', () => {
    process.env.REDIS_URL = 'redis://my-redis:6379';

    const store = createRedisRateLimitStore(undefined);

    expect(RedisMock).toHaveBeenCalledWith('redis://my-redis:6379');
    expect(RedisStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'rl:', sendCommand: expect.any(Function) }),
    );
    expect(store).toEqual(expect.objectContaining({ __isRedisStore: true }));
  });

  it('falls back to redis://localhost:6379 when no url is given', () => {
    createRedisRateLimitStore(undefined);

    expect(RedisMock).toHaveBeenCalledWith('redis://localhost:6379');
  });

  it('uses options.url and options.prefix over defaults', () => {
    createRedisRateLimitStore({ url: 'redis://custom:1234', prefix: 'custom:' });

    expect(RedisMock).toHaveBeenCalledWith('redis://custom:1234');
    expect(RedisStoreMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'custom:' }));
  });

  it('sendCommand forwards the command and args to the redis client', async () => {
    createRedisRateLimitStore(undefined);

    const { sendCommand } = RedisStoreMock.mock.calls[0][0] as {
      sendCommand: (...args: string[]) => Promise<unknown>;
    };

    await sendCommand('GET', 'foo');

    expect(redisCallMock).toHaveBeenCalledWith('GET', 'foo');
  });
});
