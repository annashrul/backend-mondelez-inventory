import { Router } from 'express';
import { createBarang, deleteBarang, generateBarangCode, getBarang, listBarang, updateBarang } from '../controllers/barangController.js';
import { uploadImage } from '../middleware/imageUpload.js';

const router = Router();
router.get('/', listBarang);
router.get('/kode-otomatis', generateBarangCode);
router.get('/:id', getBarang);
router.post('/', uploadImage, createBarang);
router.put('/:id', uploadImage, updateBarang);
router.delete('/:id', deleteBarang);

export default router;
