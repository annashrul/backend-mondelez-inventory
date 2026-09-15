import { Router } from 'express';
import { getAdjustments, getKartuStok, postAdjustment } from '../controllers/stockController.js';

export const adjustmentRoutes = Router();
adjustmentRoutes.get('/', getAdjustments);
adjustmentRoutes.post('/', postAdjustment);

export const kartuStokRoutes = Router();
kartuStokRoutes.get('/', getKartuStok);
