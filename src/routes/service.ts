import express, { Request, Response, Router } from 'express';
import type { SoftBindingRegistry } from '../softBinding';

export const C2PA_SPECIFICATION_VERSION = '2.4.0';

const SUPPORTED_CAPABILITIES = [
  'queryByContent',
  'queryByReference',
  'storeManifests',
  'storeBindings',
];

export interface ServiceStatus {
  status: 'ok' | 'degraded' | 'down';
}

export interface ServiceRouterDeps {
  softBinding: SoftBindingRegistry;
  getServiceStatus?: () => ServiceStatus | Promise<ServiceStatus>;
}

export function createServiceRouter(deps: ServiceRouterDeps): Router {
  const router = express.Router();

  // GET /services/supportedAlgorithms  — no auth required (public capability discovery)
  router.get('/services/supportedAlgorithms', (_req: Request, res: Response) => {
    try {
      return res.json(deps.softBinding.getSupportedAlgorithms());
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // GET /services/capabilities  — no auth required (public capability discovery)
  router.get('/services/capabilities', (_req: Request, res: Response) => {
    return res.json({
      c2paSpecificationVersion: C2PA_SPECIFICATION_VERSION,
      supportedCapabilities: SUPPORTED_CAPABILITIES,
    });
  });

  // GET /services/status  — no auth required
  router.get('/services/status', async (_req: Request, res: Response) => {
    let status: ServiceStatus['status'] = 'ok';
    if (deps.getServiceStatus) {
      try {
        status = (await deps.getServiceStatus()).status;
      } catch {
        status = 'down';
      }
    }
    return res.json({ status, timestamp: new Date().toISOString() });
  });

  return router;
}
