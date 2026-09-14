import { HttpError } from '../middleware/errors.js';
import * as repository from '../repositories/masterRepository.js';
import { requestUserId, safeLogActivity } from '../services/activityLogger.js';
import { paginated } from '../utils/pagination.js';

const labels = { 'kelompok-barang': 'Kelompok barang', satuan: 'Satuan', lokasi: 'Lokasi', rak: 'Rak' };
const modules = { 'kelompok-barang': 'Kelompok Barang', satuan: 'Master Satuan', lokasi: 'Master Lokasi', rak: 'Master Rak' };

function normalize(key, body, current = {}) {
  const config = repository.masterConfigs[key];
  const item = {};
  for (const field of config.fields) {
    let value = body[field] ?? current[field];
    if (field === 'kapasitas' || field === 'terisi' || field === 'lokasi_id') value = Number(value ?? 0);
    else value = typeof value === 'string' ? value.trim() : value;
    item[field] = value ?? '';
  }
  if (!item.kode || !item.nama) throw new HttpError(422, 'Kode dan nama wajib diisi');
  if (item.kode.length > 20) throw new HttpError(422, 'Kode maksimal 20 karakter');
  if (item.nama.length > 150) throw new HttpError(422, 'Nama maksimal 150 karakter');
  if (key === 'rak') {
    item.qr_code ||= `RAK:${item.kode}`;
    if (item.qr_code.length > 100) throw new HttpError(422, 'Nilai QR maksimal 100 karakter');
    if (!Number.isSafeInteger(item.lokasi_id) || item.lokasi_id < 1) throw new HttpError(422, 'lokasi_id wajib berupa ID master yang valid');
    if (!Number.isInteger(item.kapasitas) || item.kapasitas < 0) throw new HttpError(422, 'Kapasitas harus berupa bilangan bulat positif');
    item.terisi = Number(current.terisi ?? 0);
  }
  return item;
}

function mapError(error, key) {
  if (error.code === 'INVALID_REFERENCE') throw new HttpError(422, 'Lokasi tidak ditemukan pada master lokasi');
  if (error.code === '23505') throw new HttpError(409, `Kode atau nilai unik ${labels[key].toLowerCase()} sudah digunakan`);
  throw error;
}

export const list = (key) => async (req, res, next) => {
  try { res.json(paginated(await repository.findAll(key, String(req.query.search || '')), req.query)); } catch (error) { next(error); }
};

export const get = (key) => async (req, res, next) => {
  try {
    const item = await repository.findById(key, Number(req.params.id));
    if (!item) throw new HttpError(404, `${labels[key]} tidak ditemukan`);
    res.json(item);
  } catch (error) { next(error); }
};

export const create = (key) => async (req, res, next) => {
  try {
    const item = await repository.create(key, normalize(key, req.body));
    await safeLogActivity({ req, aksi: 'Tambah', modul: modules[key], detail: `Tambah ${labels[key].toLowerCase()}: ${item.nama || item.kode}` });
    res.status(201).json(item);
  }
  catch (error) { try { mapError(error, key); } catch (mapped) { next(mapped); } }
};

export const update = (key) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await repository.findById(key, id);
    if (!current) throw new HttpError(404, `${labels[key]} tidak ditemukan`);
    const item = await repository.update(key, id, normalize(key, req.body, current));
    await safeLogActivity({ req, aksi: 'Edit', modul: modules[key], detail: `Edit ${labels[key].toLowerCase()}: ${item.nama || item.kode}` });
    res.json(item);
  } catch (error) { try { mapError(error, key); } catch (mapped) { next(mapped); } }
};

export const remove = (key) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await repository.findById(key, id);
    const result = await repository.remove(key, id, requestUserId(req));
    if (result.used) throw new HttpError(409, `${labels[key]} masih digunakan dan tidak dapat dihapus`);
    if (!result.removed) throw new HttpError(404, `${labels[key]} tidak ditemukan`);
    await safeLogActivity({ req, aksi: 'Hapus', modul: modules[key], detail: `Hapus ${labels[key].toLowerCase()}: ${current?.nama || current?.kode || id}` });
    res.json({ message: `${labels[key]} berhasil dihapus` });
  } catch (error) { next(error); }
};
