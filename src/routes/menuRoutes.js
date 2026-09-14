import { Router } from 'express';
import { listMenus } from '../controllers/menuController.js';

const router = Router();
router.get('/', listMenus);

export default router;