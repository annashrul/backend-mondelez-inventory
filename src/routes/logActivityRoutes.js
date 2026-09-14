import { Router } from 'express';
import { listLogActivities } from '../controllers/logActivityController.js';

const router = Router();

router.get('/', listLogActivities);

export default router;
