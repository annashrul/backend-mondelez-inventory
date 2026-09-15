import { Router } from 'express';
import { execute, list, rackItems, scanRack, searchImage } from '../controllers/pengambilanController.js';

export const aiRoutes = Router();
aiRoutes.post('/search-image', searchImage);

export const pengambilanRoutes = Router();
pengambilanRoutes.get('/', list);
pengambilanRoutes.post('/execute', execute);

export const rackScanRoutes = Router();
rackScanRoutes.post('/scan', scanRack);
rackScanRoutes.post('/items', rackItems);
