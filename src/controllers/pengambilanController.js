import { HttpError } from '../middleware/errors.js';
import {
  executePengambilan,
  firstOperatorId,
  listBarangByRackQr,
  listPengambilan,
  searchBarangByImageEmbedding,
  verifyRackForBarang,
} from '../repositories/pengambilanRepository.js';
import { findUser } from '../repositories/accessRepository.js';
import { embedImageSource } from '../services/aiService.js';
import { verifyToken } from '../services/authService.js';
import { safeLogActivity } from '../services/activityLogger.js';
import { createPengambilanNotification } from '../services/notificationService.js';
import { paginated } from '../utils/pagination.js';

function id(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(422, `${label} tidak valid`);
  return parsed;
}

function optionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function limit(value) {
  const parsed = Number(value ?? 5);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) throw new HttpError(422, 'Limit harus 1 sampai 20');
  return parsed;
}

async function operatorId(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const payload = token ? verifyToken(token) : null;
  if (payload?.sub) {
    const user = await findUser(payload.sub);
    if (user) return Number(user.id);
  }
  const fallback = await firstOperatorId();
  if (!fallback) throw new HttpError(422, 'Operator aktif tidak ditemukan');
  return Number(fallback);
}

export async function searchImage(req, res, next) {
  try {
    const embedding = await embedImageSource(req.body?.image);
    const results = await searchBarangByImageEmbedding(embedding.embedding, limit(req.body?.limit));
    if (!results.length) throw new HttpError(404, 'Belum ada barang dengan image embedding');
    await safeLogActivity({ req, aksi: 'Cari', modul: 'AI Search Barang', detail: `Pencarian gambar menghasilkan ${results.length} kandidat` });
    res.json({ model: embedding.model, results });
  } catch (error) {
    next(error);
  }
}

export async function list(req, res, next) {
  try {
    res.json(paginated(await listPengambilan(String(req.query.search || '')), req.query));
  } catch (error) {
    next(error);
  }
}

export async function scanRack(req, res, next) {
  try {
    const qrCode = optionalText(req.body?.qr_code);
    if (!qrCode) throw new HttpError(422, 'Kode QR rak wajib diisi');
    const result = await verifyRackForBarang(qrCode, id(req.body?.barang_id, 'ID barang'));
    if (result.status === 'rack-missing') throw new HttpError(404, 'QR rak tidak terdaftar');
    if (result.status === 'barang-missing') throw new HttpError(404, 'Barang tidak ditemukan');
    if (result.status === 'wrong-rack') throw new HttpError(409, `Rak tidak sesuai. Barang berada di ${result.barang?.rak_detail?.nama || '-'}`);
    await safeLogActivity({ req, aksi: 'Scan', modul: 'Scan QR Rak', detail: `Scan QR valid: ${result.rak?.nama || qrCode} untuk ${result.barang?.nama || 'barang'}` });
    res.json({ valid: true, rak: result.rak, barang: result.barang });
  } catch (error) {
    next(error);
  }
}

export async function rackItems(req, res, next) {
  try {
    const qrCode = optionalText(req.body?.qr_code);
    if (!qrCode) throw new HttpError(422, 'Kode QR rak wajib diisi');
    const result = await listBarangByRackQr(qrCode);
    if (result.status === 'rack-missing') throw new HttpError(404, 'QR rak tidak terdaftar');
    await safeLogActivity({ req, aksi: 'Scan', modul: 'Scan QR Rak', detail: `Scan QR rak: ${result.rak?.nama || qrCode}` });
    res.json({ valid: true, rak: result.rak, barang: result.barang });
  } catch (error) {
    next(error);
  }
}

export async function execute(req, res, next) {
  try {
    const payload = {
      barang_id: id(req.body?.barang_id, 'ID barang'),
      rak_id: id(req.body?.rak_id, 'ID rak'),
      qr_code: optionalText(req.body?.qr_code),
      pemohon: optionalText(req.body?.pemohon),
      qty: Number(req.body?.qty),
      keterangan: optionalText(req.body?.keterangan),
    };
    if (!payload.qr_code) throw new HttpError(422, 'Kode QR rak wajib diisi');
    if (!payload.pemohon) throw new HttpError(422, 'Nama pengambil wajib diisi');
    if (!Number.isInteger(payload.qty) || payload.qty < 1) throw new HttpError(422, 'Qty harus bilangan bulat minimal 1');

    const actorId = await operatorId(req);
    const response = await executePengambilan(payload, actorId, req.ip);
    await createPengambilanNotification({
      transaction: response.transaction,
      stokAkhir: response.stok_akhir,
      createdBy: actorId,
    });
    res.status(201).json(response);
  } catch (error) {
    if (error.code === 'NOT_FOUND') return next(new HttpError(404, 'Barang atau rak tidak ditemukan'));
    if (error.code === 'WRONG_RACK') return next(new HttpError(409, 'QR rak belum valid atau tidak sesuai barang'));
    if (error.code === 'INSUFFICIENT_STOCK') return next(new HttpError(409, `Stok tidak cukup. Stok tersedia ${error.stock} ${error.satuan || ''}`.trim()));
    next(error);
  }
}
