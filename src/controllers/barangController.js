import { create, findAll, findById, remove, update } from '../repositories/barangRepository.js';
import { HttpError } from '../middleware/errors.js';
import { embedImage } from '../services/aiService.js';
import { deleteProductImage, uploadProductImage } from '../services/imageStorage.js';

const editableFields = ['kode', 'barcode', 'nama', 'kelompok', 'satuan', 'rak', 'stok', 'stok_min', 'harga'];

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID barang tidak valid');
  return id;
}

function validate(payload, current = {}) {
  const item = Object.fromEntries(editableFields.map((field) => [field, payload[field] ?? current[field]]));
  for (const field of ['kode', 'barcode', 'nama', 'kelompok', 'satuan', 'rak']) {
    if (typeof item[field] !== 'string' || !item[field].trim()) throw new HttpError(422, `${field} wajib diisi`);
    item[field] = item[field].trim();
  }
  if (item.kode.length > 30) throw new HttpError(422, 'Kode maksimal 30 karakter');
  if (item.barcode.length > 100) throw new HttpError(422, 'Barcode maksimal 100 karakter');
  for (const field of ['stok', 'stok_min', 'harga']) {
    item[field] = Number(item[field]);
    if (!Number.isFinite(item[field]) || item[field] < 0) throw new HttpError(422, `${field} harus berupa angka nol atau lebih`);
  }
  if (!Number.isInteger(item.stok) || !Number.isInteger(item.stok_min)) throw new HttpError(422, 'Stok dan stok minimum harus berupa bilangan bulat');
  return item;
}

function mapDatabaseError(error) {
  if (error.code === '23505') {
    const field = error.constraint?.includes('barcode') ? 'Barcode' : 'Kode barang';
    throw new HttpError(409, `${field} sudah digunakan`);
  }
  throw error;
}

export async function listBarang(req, res) {
  res.json(await findAll(String(req.query.search || '')));
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
    res.status(201).json(await create(item, uploaded));
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
  if (!await remove(id)) throw new HttpError(404, 'Barang tidak ditemukan');
  if (current.image_path) await deleteProductImage(current.image_path).catch(console.error);
  res.json({ message: 'Barang berhasil dihapus' });
}