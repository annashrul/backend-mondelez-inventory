import { create, findAll, findById, remove, update } from '../repositories/barangRepository.js';
import { HttpError } from '../middleware/errors.js';
import { embedImage } from '../services/aiService.js';
import { deleteProductImage, uploadProductImage } from '../services/imageStorage.js';
import { requestUserId, safeLogActivity } from '../services/activityLogger.js';
import { paginated } from '../utils/pagination.js';

const editableFields = ['kode', 'barcode', 'nama', 'kelompok_id', 'satuan_id', 'rak_id', 'stok', 'stok_min', 'harga'];

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID barang tidak valid');
  return id;
}

function validate(payload, current = {}) {
  const item = Object.fromEntries(editableFields.map((field) => [field, payload[field] ?? current[field]]));
  for (const field of ['kode', 'barcode', 'nama']) {
    if (typeof item[field] !== 'string' || !item[field].trim()) throw new HttpError(422, `${field} wajib diisi`);
    item[field] = item[field].trim();
  }
  if (item.kode.length > 30) throw new HttpError(422, 'Kode maksimal 30 karakter');
  if (item.barcode.length > 100) throw new HttpError(422, 'Barcode maksimal 100 karakter');
  for (const field of ['kelompok_id', 'satuan_id', 'rak_id']) {
    item[field] = Number(item[field]);
    if (!Number.isSafeInteger(item[field]) || item[field] < 1) throw new HttpError(422, `${field} wajib berupa ID master yang valid`);
  }
  for (const field of ['stok', 'stok_min', 'harga']) {
    item[field] = Number(item[field]);
    if (!Number.isFinite(item[field]) || item[field] < 0) throw new HttpError(422, `${field} harus berupa angka nol atau lebih`);
  }
  if (!Number.isInteger(item.stok) || !Number.isInteger(item.stok_min)) throw new HttpError(422, 'Stok dan stok minimum harus berupa bilangan bulat');
  return item;
}

function mapDatabaseError(error) {
  if (error.code === 'INVALID_REFERENCE') throw new HttpError(422, 'Kelompok, satuan, atau rak tidak ditemukan pada master data');
  if (error.code === '23503') throw new HttpError(409, 'Barang masih digunakan pada transaksi dan tidak dapat dihapus');
  if (error.code === '23505') {
    const field = error.constraint?.includes('barcode') ? 'Barcode' : 'Kode barang';
    throw new HttpError(409, `${field} sudah digunakan`);
  }
  throw error;
}

export async function listBarang(req, res) {
  res.json(paginated(await findAll(String(req.query.search || '')), req.query));
}

export async function getBarang(req, res) {
  const id = parseId(req.params.id);
  const item = await findById(id);
  if (!item) throw new HttpError(404, 'Barang tidak ditemukan');
  res.json(item);
}

export async function createBarang(req, res) {
  let uploaded;
  try {
    const item = validate(req.body);
    if (req.file) {
      const ai = await embedImage(req.file);
      uploaded = await uploadProductImage(req.file, item.kode);
      uploaded = { ...uploaded, ...ai };
    }
    const result = await create(item, uploaded);
    await safeLogActivity({ req, aksi: 'Tambah', modul: 'Master Barang', detail: `Tambah barang: ${result.nama || result.kode}` });
    res.status(201).json(result);
  } catch (error) {
    if (uploaded?.path) await deleteProductImage(uploaded.path).catch(console.error);
    mapDatabaseError(error);
  }
}

export async function updateBarang(req, res) {
  const id = parseId(req.params.id);
  const current = await findById(id);
  if (!current) throw new HttpError(404, 'Barang tidak ditemukan');
  let uploaded;
  try {
    const item = validate(req.body, current);
    if (req.file) {
      const ai = await embedImage(req.file);
      uploaded = { ...await uploadProductImage(req.file, item.kode), ...ai };
    }
    const result = await update(id, item, uploaded);
    if (uploaded && current.image_path) await deleteProductImage(current.image_path).catch(console.error);
    await safeLogActivity({ req, aksi: 'Edit', modul: 'Master Barang', detail: `Edit barang: ${result.nama || result.kode}` });
    res.json(result);
  } catch (error) {
    if (uploaded?.path) await deleteProductImage(uploaded.path).catch(console.error);
    mapDatabaseError(error);
  }
}

export async function deleteBarang(req, res) {
  const id = parseId(req.params.id);
  const current = await findById(id);
  if (!current) throw new HttpError(404, 'Barang tidak ditemukan');
  try {
    if (!await remove(id, requestUserId(req))) throw new HttpError(404, 'Barang tidak ditemukan');
    await safeLogActivity({ req, aksi: 'Hapus', modul: 'Master Barang', detail: `Arsip barang: ${current.nama || current.kode}` });
    res.json({ message: 'Barang berhasil dihapus' });
  } catch (error) {
    if (error.code === '23503') {
      await safeLogActivity({ req, aksi: 'Gagal Hapus', modul: 'Master Barang', detail: `Gagal hapus barang karena masih digunakan transaksi: ${current.nama || current.kode}` });
    }
    mapDatabaseError(error);
  }
}
