import pino, { type Logger as Pino } from 'pino';
import type { Logger, LoggerPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

export interface PinoLoggerOptions {
  /** Minimum log level. Default: LOG_LEVEL env var, else 'info'. */
  level?: string;
}

function wrap(pinoLogger: Pino): Logger {
  return {
    debug: (msg, meta) => pinoLogger.debug(meta ?? {}, msg),
    info: (msg, meta) => pinoLogger.info(meta ?? {}, msg),
    warn: (msg, meta) => pinoLogger.warn(meta ?? {}, msg),
    error: (msg, meta) => pinoLogger.error(meta ?? {}, msg),
    child: (bindings) => wrap(pinoLogger.child(bindings)),
  };
}

const createPinoLogger: LoggerPlugin<PinoLoggerOptions | undefined> = (options) => {
  const level = options?.level ?? process.env.LOG_LEVEL ?? 'info';
  return wrap(pino({ level }));
};

export default createPinoLogger;
