# @cognitiveproof/softbinding-api-plugin-pino-logger

[Pino](https://getpino.io/) `LoggerPlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Replaces the server's built-in console JSON logger with [Pino](https://getpino.io/) — a very low-overhead structured logger. `createServer()` uses this logger for request logging (`{ method, path, status, durationMs }` per request) and for error reporting in the global error handler.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-pino-logger
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  logger: '@cognitiveproof/softbinding-api-plugin-pino-logger',
});
```

Or pass the package name via the `LOGGER_PLUGIN` environment variable and omit the `logger` option entirely.

To pass options (instead of relying on `LOG_LEVEL`), import and call the plugin directly:

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';
import createPinoLogger from '@cognitiveproof/softbinding-api-plugin-pino-logger';

const app = createServer({
  logger: createPinoLogger({ level: 'debug' }),
});
```

## Configuration

| Option  | Env var     | Default | Description                                                                      |
| ------- | ----------- | ------- | -------------------------------------------------------------------------------- |
| `level` | `LOG_LEVEL` | `info`  | Minimum log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`) |

## License

[MIT](LICENSE)
