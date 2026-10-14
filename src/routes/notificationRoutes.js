import { settingsAccess } from '../middleware/settingsAccess.js';
import { Router } from 'express';
import { testEmail } from '../controllers/testEmailController.js';
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
router.get('/settings', settingsAccess(), getSettings);
router.put('/settings', settingsAccess('pengaturan.update'), updateSettings);
router.post('/test-email', testEmail);

export default router;
