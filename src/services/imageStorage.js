import { v2 as cloudinary } from 'cloudinary';
import { HttpError } from '../middleware/errors.js';

export async function uploadProductImage(file, kode) {
  if (process.env.NODE_ENV === 'test') return { path: `test/${kode}`, url: `https://example.test/${kode}.jpg` };
  if (!process.env.CLOUDINARY_URL) throw new HttpError(503, 'CLOUDINARY_URL belum dikonfigurasi');
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'inventory/barang', public_id: `${kode}-${Date.now()}`, resource_type: 'image', overwrite: false },
      (error, result) => error ? reject(new HttpError(502, `Upload gambar gagal: ${error.message}`)) : resolve({ path: result.public_id, url: result.secure_url })
    );
    stream.end(file.buffer);
  });
}

export async function deleteProductImage(path) {
  if (!path || process.env.NODE_ENV === 'test') return;
  await cloudinary.uploader.destroy(path, { resource_type: 'image', invalidate: true });
}