// Resolves the Logger used for request logging and error reporting: either a
// Logger instance passed directly (e.g. by a library consumer), or an npm
// package name to require() — falling back to LOGGER_PLUGIN. If none is
// configured, a built-in console-based JSON logger is used.

import type { RequestHandler } from 'express';
import type { Logger, LoggerPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

/**
 * Default Logger that writes structured JSON lines to stdout (debug/info/warn)
 * and stderr (error) — no extra dependencies required.
 */
export function createConsoleLogger(bindings: Record<string, unknown> = {}): Logger {
  const write = (stream: NodeJS.WriteStream, level: string, msg: string, meta?: Record<string, unknown>) => {
    stream.write(
      `${JSON.stringify({ level, time: new Date().toISOString(), msg, ...bindings, ...meta })}\n`,
    );
  };

  return {
    debug: (msg, meta) => write(process.stdout, 'debug', msg, meta),
    info: (msg, meta) => write(process.stdout, 'info', msg, meta),
    warn: (msg, meta) => write(process.stdout, 'warn', msg, meta),
    error: (msg, meta) => write(process.stderr, 'error', msg, meta),
    child: (childBindings) => createConsoleLogger({ ...bindings, ...childBindings }),
  };
}

function loadLoggerPlugin(packageName: string): LoggerPlugin<unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require(packageName) as { default: LoggerPlugin<unknown> }).default;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Logger plugin "${packageName}" is not installed. Run \`npm install ${packageName}\`.`);
    }
    throw err;
  }
}

export function resolveLogger(logger?: Logger | string): Logger {
  if (logger && typeof logger === 'object') return logger;

  const packageName = logger ?? process.env.LOGGER_PLUGIN;
  if (!packageName) return createConsoleLogger();

  return loadLoggerPlugin(packageName)(undefined);
}

/**
 * Express middleware that logs each request's method, path, status code, and
 * duration once the response finishes.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  };
}
