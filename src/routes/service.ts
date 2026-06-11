import express, { Request, Response, Router } from 'express';
import type { SoftBindingRegistry } from '../softBinding';

export interface ServiceRouterDeps {
  softBinding: SoftBindingRegistry;
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

  return router;
}
