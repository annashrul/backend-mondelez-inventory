import { HttpError } from '../middleware/errors.js';
import * as repository from '../repositories/masterRepository.js';

const labels = { 'kelompok-barang': 'Kelompok barang', satuan: 'Satuan', lokasi: 'Lokasi', rak: 'Rak' };

function normalize(key, body, current = {}) {
  const config = repository.masterConfigs[key];
  const item = {};
  for (const field of config.fields) {
    let value = body[field] ?? current[field];
    if (field === 'kapasitas' || field === 'terisi') value = Number(value ?? 0);
    else value = typeof value === 'string' ? value.trim() : value;
    item[field] = value ?? '';
  }
  if (!item.kode || !item.nama) throw new HttpError(422, 'Kode dan nama wajib diisi');
  if (item.kode.length > 20) throw new HttpError(422, 'Kode maksimal 20 karakter');
  if (item.nama.length > 150) throw new HttpError(422, 'Nama maksimal 150 karakter');
  if (key === 'rak') {
    item.qr_code ||= `RAK:${item.kode}`;
    if (item.qr_code.length > 100) throw new HttpError(422, 'Nilai QR maksimal 100 karakter');
    if (!item.lokasi) throw new HttpError(422, 'Lokasi wajib dipilih');
    if (!Number.isInteger(item.kapasitas) || item.kapasitas < 0) throw new HttpError(422, 'Kapasitas harus berupa bilangan bulat positif');
    item.terisi = Number(current.terisi ?? 0);
  }
  return item;
}

function mapError(error, key) {
  if (error.code === '23505') throw new HttpError(409, `Kode atau nilai unik ${labels[key].toLowerCase()} sudah digunakan`);
  throw error;
}

export const list = (key) => async (req, res, next) => {
  try { res.json(await repository.findAll(key)); } catch (error) { next(error); }
};

export const get = (key) => async (req, res, next) => {
  try {
    const item = await repository.findById(key, Number(req.params.id));
    if (!item) throw new HttpError(404, `${labels[key]} tidak ditemukan`);
    res.json(item);
  } catch (error) { next(error); }
};

export const create = (key) => async (req, res, next) => {
  try { res.status(201).json(await repository.create(key, normalize(key, req.body))); }
  catch (error) { try { mapError(error, key); } catch (mapped) { next(mapped); } }
};

export const update = (key) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await repository.findById(key, id);
    if (!current) throw new HttpError(404, `${labels[key]} tidak ditemukan`);
    res.json(await repository.update(key, id, normalize(key, req.body, current)));
  } catch (error) { try { mapError(error, key); } catch (mapped) { next(mapped); } }
};

export const remove = (key) => async (req, res, next) => {
  try {
    const result = await repository.remove(key, Number(req.params.id));
    if (result.used) throw new HttpError(409, `${labels[key]} masih digunakan dan tidak dapat dihapus`);
    if (!result.removed) throw new HttpError(404, `${labels[key]} tidak ditemukan`);
    res.json({ message: `${labels[key]} berhasil dihapus` });
  } catch (error) { next(error); }
};