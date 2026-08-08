import path from 'path';
import fs from 'fs';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { resolveConfig, type SoftBindingServerOptions } from './config';
import { loadDataStore } from './store';
import { createSoftBindingRegistry } from './softBinding';
import { resolveAuthMiddleware, resolveOptionalAuthMiddleware } from './auth';
import { resolveLogger, createRequestLogger } from './logger';
import { resolveRateLimitStore } from './rateLimit';
import { createQueryRouter } from './routes/query';
import { createStoreRouter } from './routes/store';
import { createFetchRouter } from './routes/fetch';
import { createServiceRouter, C2PA_SPECIFICATION_VERSION } from './routes/service';

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
export type { AuthContext, AuthScope, JwtAuthOptions } from './auth';
export type { Logger, LoggerPlugin } from '@cognitiveproof/softbinding-api-plugin-types';
export type { HelmetOptions } from 'helmet';
export type { Options as RateLimitOptions, Store as RateLimitStore } from 'express-rate-limit';
export type { RateLimitStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
export { loadDataStore } from './store';
export { loadObjectStore } from './objectStore';
export {
  AUTH_SCOPES_LOCALS_KEY,
  AUTH_CONTEXT_LOCALS_KEY,
  createJwtAuthMiddleware,
  createOptionalJwtAuthMiddleware,
  requireAuthScope,
} from './auth';
export { createConsoleLogger } from './logger';

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

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
  const optionalAuth = resolveOptionalAuthMiddleware(options.auth, options.gcpProjectId);
  const logger = resolveLogger(options.logger);
  const rateLimitStore = resolveRateLimitStore(options.rateLimitStore);

  if (!options.parseManifestId) {
    logger.warn(
      'parseManifestId is not configured — POST /manifests will assign each manifest a ' +
        'randomly generated id instead of the id embedded in the manifest itself. This does ' +
        "not match the C2PA spec, which requires manifestId to be the active manifest's own " +
        'label. See the README section "Deriving manifestId from the Manifest Itself" to fix ' +
        'this.',
    );
  }

  const app = express();

  if (config.helmet !== false) {
    app.use(helmet(config.helmet));
  }

  app.use(createRequestLogger(logger));

  // Global JSON body parser — individual routes add their own raw parsers as needed
  app.use(express.json({ limit: config.maxJsonSize }));

  app.get('/', (_req, res) => res.send('C2PA-Softbinding-Server - Healthy'));

  if (config.docs) {
    const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
    const openapiDocument = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));

    app.get('/v1/openapi.json', (_req, res) => res.json(openapiDocument));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
  }

  const WELL_KNOWN_PATH = '/.well-known/c2pa-soft-binding-resolution';

  if (config.rateLimit !== false) {
    const limiter = rateLimit({
      ...config.rateLimit,
      ...(rateLimitStore ? { store: rateLimitStore } : {}),
    });
    app.use('/v1', limiter);
    app.use(WELL_KNOWN_PATH, limiter);
  }

  // Discovery endpoint per RFC 8615 — served at the domain root, not under
  // /v1, so clients can find the API without knowing the version prefix.
  app.get(WELL_KNOWN_PATH, (_req, res) => {
    res.json({
      apiEndpoint: '/v1',
      c2paSpecificationVersion: C2PA_SPECIFICATION_VERSION,
      capabilitiesEndpoint: '/v1/services/capabilities',
      statusEndpoint: '/v1/services/status',
    });
  });

  app.use(
    '/v1',
    createQueryRouter({
      dataStore,
      softBinding,
      auth,
      maxUploadSize: config.maxUploadSize,
      maxReferenceSize: config.maxReferenceSize,
      maxQueryValueLength: config.maxQueryValueLength,
    }),
  );
  app.use(
    '/v1',
    createStoreRouter({
      dataStore,
      auth,
      repoUri: config.repoUri,
      receiptSecret: config.receiptSecret,
      parseManifestId: options.parseManifestId,
    }),
  );
  app.use(
    '/v1',
    createFetchRouter({
      dataStore,
      auth,
      optionalAuth,
      receiptSecret: config.receiptSecret,
      isManifestAuthRequired: options.isManifestAuthRequired,
      manifestHtmlRedirect: options.manifestHtmlRedirect,
    }),
  );
  app.use('/v1', createServiceRouter({ softBinding, getServiceStatus: options.getServiceStatus }));

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));

  app.use((err: BodyParserError, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body exceeds the configured size limit' });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON request body' });
      return;
    }

    logger.error(err.message, { stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
