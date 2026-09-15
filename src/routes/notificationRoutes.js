import { Router } from 'express';
import {
  getSettings,
  listUserNotifications,
  readAllNotifications,
  readNotification,
  updateSettings,
} from '../controllers/notificationController.js';

const router = Router();

router.get('/', listUserNotifications);
router.patch('/read-all', readAllNotifications);
router.patch('/:id/read', readNotification);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

export default router;
