import { HttpError } from '../middleware/errors.js';
import { verifyToken } from '../services/authService.js';
import { findUser } from '../repositories/accessRepository.js';
import { logActivity } from '../services/activityLogger.js';
import { menuCatalog } from '../data/menuCatalog.js';
import { settingsChanges } from '../utils/activityDetails.js';

const permissions = new Set(menuCatalog.flatMap(menu => menu.actions.map(([key]) => `${menu.key}.${key}`)));
export async function recordActivityEvent(req, res, next) {
  try {
    let token;
    try { token = verifyToken(req.headers.authorization?.replace(/^Bearer\s+/i, '')); } catch { token = null; }
    if (!token?.sub) throw new HttpError(401, 'Silakan login kembali');
    const user = await findUser(token.sub);
    if (!user || user.status !== 'Aktif') throw new HttpError(403, 'Akun tidak aktif');
    const body = req.body || {};
    const menu = menuCatalog.find(menu => menu.path === body.path);
    if (!menu) throw new HttpError(422, 'Halaman aktivitas tidak valid');
    let aksi, detail;
    if (body.type === 'navigation') {
      aksi = 'Navigasi';
      const tab = ['umum', 'notifikasi', 'tampilan', 'database', 'keamanan', 'transaksi', 'riwayat'].includes(body.tab) ? `; tab ${body.tab}` : '';
      detail = `Membuka halaman ${menu.nama}${tab}`;
    } else if (body.type === 'preference') {
      for (const [key, values] of Object.entries({ tema: ['light', 'dark'], bahasa: ['id', 'en'] })) {
        for (const value of [body.before?.[key], body.after?.[key]]) if (value !== undefined && !values.includes(value)) throw new HttpError(422, 'Preferensi tidak valid');
      }
      aksi = 'Edit Preferensi';
      detail = settingsChanges(body.before || {}, body.after || {}, ['tema', 'bahasa']);
    } else if (body.type === 'print') {
      if (!user.permissions?.some(permission => permission === '*' || permission === 'barcode.print')) throw new HttpError(403, 'Tidak mempunyai akses cetak');
      if (!Array.isArray(body.rack_ids) || !body.rack_ids.length || body.rack_ids.length > 1000 || body.rack_ids.some(id => !/^[1-9][0-9]*$/.test(String(id)))) throw new HttpError(422, 'Rak cetak tidak valid');
      aksi = 'Cetak'; detail = `Membuka dialog cetak QR untuk rak ID: ${body.rack_ids.join(', ')}`;
    } else if (body.type === 'access_denied') {
      if (!permissions.has(body.permission)) throw new HttpError(422, 'Hak akses tidak valid');
      aksi = 'Ditolak Akses'; detail = `Percobaan aksi ${body.permission} pada ${menu.nama}`;
    } else if (body.type === 'search') {
      if (typeof body.search !== 'string' || body.search.length > 200) throw new HttpError(422, 'Pencarian tidak valid');
      aksi = 'Cari'; detail = `Pencarian antarmuka ${menu.nama}: ${body.search || '(dikosongkan)'}`;
    } else if (body.type === 'application') {
      const actions = { install_prompt: 'Membuka permintaan instalasi aplikasi', install_accepted: 'Menyetujui instalasi aplikasi', install_dismissed: 'Membatalkan instalasi aplikasi', install_failed: 'Instalasi aplikasi gagal', update_request: 'Meminta pembaruan aplikasi', update_failed: 'Pembaruan aplikasi gagal' };
      if (!Object.hasOwn(actions, body.action)) throw new HttpError(422, 'Aktivitas aplikasi tidak valid');
      aksi = 'Aplikasi'; detail = actions[body.action];
    } else if (body.type === 'filter') {
      if (!((body.name === 'tipe' && ['Semua', 'Masuk', 'Keluar'].includes(body.value)) || (body.name === 'periode' && [7, 14, 30, 90].includes(body.value)))) throw new HttpError(422, 'Filter tidak valid');
      aksi = 'Filter'; detail = `Filter antarmuka ${menu.nama}: ${body.name}=${body.value}`;
    } else if (body.type === 'pagination') {
      if (!Number.isInteger(body.page) || body.page < 1 || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100) throw new HttpError(422, 'Pagination tidak valid');
      aksi = 'Navigasi Data'; detail = `Antarmuka ${menu.nama}: halaman ${body.page}, ${body.limit} data per halaman`;
    } else throw new HttpError(422, 'Jenis aktivitas tidak valid');
    await logActivity({ req, userId: Number(user.id), aksi, modul: body.type === 'preference' ? 'Preferensi Pribadi' : body.type === 'application' ? 'Aplikasi' : menu.nama, detail });
    res.status(201).json({ recorded: true });
  } catch (error) { next(error); }
}
