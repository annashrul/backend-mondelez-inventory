import { Router } from 'express';
import { stats } from '../controllers/dashboardController.js';

const router = Router();

router.get('/stats', stats);

export default router;
