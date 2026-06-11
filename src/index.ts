import path from 'path';
import fs from 'fs';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { resolveConfig, type SoftBindingServerOptions } from './config';
import { loadDataStore } from './store';
import { createSoftBindingRegistry } from './softBinding';
import { resolveAuthMiddleware } from './auth';
import { resolveLogger, createRequestLogger } from './logger';
import { createQueryRouter } from './routes/query';
import { createStoreRouter } from './routes/store';
import { createFetchRouter } from './routes/fetch';
import { createServiceRouter } from './routes/service';

export type { SoftBindingServerOptions } from './config';
export type {
  DataStorePlugin,
  ObjectStorePlugin,
  Match,
  ManifestEntry,
  Receipt,
  LoadedData,
} from '@cognitiveproof/softbinding-api-plugin-types';
export type { Extractor, SupportedAlgorithms, SoftBindingRegistry } from './softBinding';
export type { AuthPlugin } from '@cognitiveproof/softbinding-api-plugin-types';
export type { JwtAuthOptions } from './auth';
export type { Logger, LoggerPlugin } from '@cognitiveproof/softbinding-api-plugin-types';
export type { HelmetOptions } from 'helmet';
export { loadDataStore } from './store';
export { loadObjectStore } from './objectStore';
export { createJwtAuthMiddleware } from './auth';
export { createConsoleLogger } from './logger';

/**
 * Builds a configured C2PA Soft Binding Resolution API Express app.
 *
 * The returned app does not call `listen()` — mount it directly
 * (`app.use('/c2pa', createServer(...))`) or call `.listen(port)` on it for
 * standalone use.
 */
export function createServer(options: SoftBindingServerOptions = {}): Express {
  const config = resolveConfig(options);
  const dataStore = loadDataStore(options.dataStore);
  const softBinding = createSoftBindingRegistry(options.extractors);
  const auth = resolveAuthMiddleware(options.auth, options.gcpProjectId);
  const logger = resolveLogger(options.logger);

  const app = express();

  if (config.helmet !== false) {
    app.use(helmet(config.helmet));
  }

  app.use(createRequestLogger(logger));

  // Global JSON body parser — individual routes add their own raw parsers as needed
  app.use(express.json());

  app.get('/', (_req, res) => res.send('C2PA-Softbinding-Server - Healthy'));

  if (config.docs) {
    const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
    const openapiDocument = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));

    app.get('/v1/openapi.json', (_req, res) => res.json(openapiDocument));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
  }

  app.use(
    '/v1',
    createQueryRouter({
      dataStore,
      softBinding,
      auth,
      maxUploadSize: config.maxUploadSize,
      maxReferenceSize: config.maxReferenceSize,
    }),
  );
  app.use(
    '/v1',
    createStoreRouter({
      dataStore,
      auth,
      repoUri: config.repoUri,
      receiptSecret: config.receiptSecret,
    }),
  );
  app.use('/v1', createFetchRouter({ dataStore, auth, receiptSecret: config.receiptSecret }));
  app.use('/v1', createServiceRouter({ softBinding }));

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err.message, { stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
