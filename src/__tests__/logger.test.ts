import express from 'express';
import request from 'supertest';
import { createConsoleLogger, createRequestLogger, resolveLogger } from '../logger';
import type { Logger } from '@cognitiveproof/softbinding-api-plugin-types';

describe('createConsoleLogger', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('writes info/debug/warn to stdout as JSON', () => {
    const logger = createConsoleLogger();

    logger.info('hello', { foo: 'bar' });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'info', msg: 'hello', foo: 'bar' });
    expect(line.time).toEqual(expect.any(String));
  });

  it('writes error to stderr as JSON', () => {
    const logger = createConsoleLogger();

    logger.error('boom', { stack: 'trace' });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'error', msg: 'boom', stack: 'trace' });
  });

  it('child() merges bindings into every log entry', () => {
    const logger = createConsoleLogger({ service: 'softbinding' });
    const child = logger.child({ requestId: 'abc' });

    child.warn('careful');

    const line = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'warn', msg: 'careful', service: 'softbinding', requestId: 'abc' });
  });
});

describe('resolveLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LOGGER_PLUGIN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a Logger instance as-is', () => {
    const custom: Logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    };

    expect(resolveLogger(custom)).toBe(custom);
  });

  it('falls back to the console logger when nothing is configured', () => {
    const logger = resolveLogger();

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('throws a helpful error when LOGGER_PLUGIN points at a missing package', () => {
    process.env.LOGGER_PLUGIN = '@cognitiveproof/does-not-exist';

    expect(() => resolveLogger()).toThrow(
      'Logger plugin "@cognitiveproof/does-not-exist" is not installed. Run `npm install @cognitiveproof/does-not-exist`.',
    );
  });
});

describe('createRequestLogger', () => {
  it('logs method, path, status, and duration once the response finishes', async () => {
    const logger: Logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    };

    const app = express();
    app.use(createRequestLogger(logger));
    app.get('/hello', (_req, res) => res.status(200).send('ok'));

    await request(app).get('/hello');

    expect(logger.info).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({ method: 'GET', path: '/hello', status: 200, durationMs: expect.any(Number) }),
    );
  });
});
