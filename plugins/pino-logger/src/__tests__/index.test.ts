function createFakePinoLogger() {
  const logger: Record<string, jest.Mock> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => createFakePinoLogger());
  return logger;
}

const pinoMock = jest.fn((..._args: unknown[]) => createFakePinoLogger());
jest.mock('pino', () => ({
  __esModule: true,
  default: (...args: [unknown]) => pinoMock(...args),
}));

import createPinoLogger from '../index';

describe('createPinoLogger', () => {
  beforeEach(() => {
    pinoMock.mockClear();
    delete process.env.LOG_LEVEL;
  });

  it('maps Logger methods onto pino, putting meta first and msg second', () => {
    const logger = createPinoLogger(undefined);
    const pinoInstance = pinoMock.mock.results[0].value;

    logger.debug('debug message', { a: 1 });
    logger.info('info message', { b: 2 });
    logger.warn('warn message');
    logger.error('error message', { err: 'boom' });

    expect(pinoInstance.debug).toHaveBeenCalledWith({ a: 1 }, 'debug message');
    expect(pinoInstance.info).toHaveBeenCalledWith({ b: 2 }, 'info message');
    expect(pinoInstance.warn).toHaveBeenCalledWith({}, 'warn message');
    expect(pinoInstance.error).toHaveBeenCalledWith({ err: 'boom' }, 'error message');
  });

  it('child() wraps a pino child logger with the given bindings', () => {
    const logger = createPinoLogger(undefined);
    const pinoInstance = pinoMock.mock.results[0].value;

    const child = logger.child({ requestId: 'abc-123' });
    child.info('handled request', { status: 200 });

    expect(pinoInstance.child).toHaveBeenCalledWith({ requestId: 'abc-123' });
    const childPinoInstance = pinoInstance.child.mock.results[0].value;
    expect(childPinoInstance.info).toHaveBeenCalledWith({ status: 200 }, 'handled request');
  });

  it('defaults to "info" when no level option or LOG_LEVEL is set', () => {
    createPinoLogger(undefined);
    expect(pinoMock).toHaveBeenCalledWith({ level: 'info' });
  });

  it('uses options.level over LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'warn';
    createPinoLogger({ level: 'debug' });
    expect(pinoMock).toHaveBeenCalledWith({ level: 'debug' });
  });

  it('falls back to LOG_LEVEL when no options.level is given', () => {
    process.env.LOG_LEVEL = 'warn';
    createPinoLogger(undefined);
    expect(pinoMock).toHaveBeenCalledWith({ level: 'warn' });
  });
});
