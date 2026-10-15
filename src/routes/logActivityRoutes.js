import { recordActivityEvent } from '../controllers/activityEventsController.js';
import { Router } from 'express';
import { listLogActivities } from '../controllers/logActivityController.js';

const router = Router();

router.get('/', listLogActivities);
router.post('/events', recordActivityEvent);

export default router;
