import multer from 'multer';
import { HttpError } from './errors.js';

const maxSize = (Number(process.env.IMAGE_MAX_SIZE_MB) || 5) * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSize, files: 1 },
  fileFilter(req, file, callback) {
    callback(allowedTypes.has(file.mimetype) ? null : new HttpError(422, 'Gambar harus berformat JPEG, PNG, atau WebP'), allowedTypes.has(file.mimetype));
  }
}).single('image');