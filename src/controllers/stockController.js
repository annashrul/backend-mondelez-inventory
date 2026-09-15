import { HttpError } from '../middleware/errors.js';
import { createAdjustment, listAdjustments, listKartuStok } from '../repositories/stockRepository.js';
import { requestUserId, safeLogActivity } from '../services/activityLogger.js';
import { paginated } from '../utils/pagination.js';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function payload(body = {}) {
  const item = {
    tanggal: text(body.tanggal) || new Date().toISOString().slice(0, 10),
    barang_id: Number(body.barang_id),
    tipe: text(body.tipe),
    qty: Number(body.qty),
    alasan: text(body.alasan),
  };
  if (!Number.isSafeInteger(item.barang_id) || item.barang_id < 1) throw new HttpError(422, 'Barang wajib dipilih');
  if (!['Tambah', 'Kurang'].includes(item.tipe)) throw new HttpError(422, 'Tipe adjustment harus Tambah atau Kurang');
  if (!Number.isInteger(item.qty) || item.qty < 1) throw new HttpError(422, 'Qty harus bilangan bulat minimal 1');
  if (!item.alasan) throw new HttpError(422, 'Alasan adjustment wajib diisi');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.tanggal)) throw new HttpError(422, 'Tanggal harus berformat YYYY-MM-DD');
  return item;
}

export async function getAdjustments(req, res, next) {
  try {
    res.json(paginated(await listAdjustments({ search: String(req.query.search || '') }), req.query));
  } catch (error) {
    next(error);
  }
}

export async function postAdjustment(req, res, next) {
  try {
    const result = await createAdjustment(payload(req.body), requestUserId(req));
    await safeLogActivity({
      req,
      aksi: 'Adjustment',
      modul: 'Adjustment Stok',
      detail: `${result.adjustment.no_ref}: ${result.adjustment.barang_detail?.nama || 'Barang'} ${result.adjustment.tipe} ${result.adjustment.qty}. Saldo akhir ${result.saldo}`,
    });
    res.status(201).json(result.adjustment);
  } catch (error) {
    if (error.code === 'BARANG_NOT_FOUND') return next(new HttpError(404, 'Barang tidak ditemukan atau sudah diarsipkan'));
    if (error.code === 'INSUFFICIENT_STOCK') return next(new HttpError(409, `Stok tidak cukup. Stok tersedia ${error.stock}`));
    next(error);
  }
}

export async function getKartuStok(req, res, next) {
  try {
    res.json(paginated(await listKartuStok({
      search: String(req.query.search || ''),
      tipe: String(req.query.tipe || 'Semua'),
    }), req.query));
  } catch (error) {
    next(error);
  }
}
