import express, { Request, Response } from 'express';
import { getSupportedAlgorithms } from '../softBinding';

const router = express.Router();

// GET /services/supportedAlgorithms  — no auth required (public capability discovery)
router.get('/services/supportedAlgorithms', (_req: Request, res: Response) => {
  try {
    return res.json(getSupportedAlgorithms());
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

export default router;
