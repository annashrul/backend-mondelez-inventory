import { safeLogActivity } from '../services/activityLogger.js';

const modules = { 'log-activity': 'Log Activity', settings: 'Pengaturan', notifications: 'Notifikasi', auth: 'Auth', barang: 'Master Barang', 'kelompok-barang': 'Kelompok Barang', satuan: 'Master Satuan', lokasi: 'Master Lokasi', rak: 'Master Rak', pengguna: 'Master Pengguna', 'level-pengguna': 'Level Pengguna', adjustment: 'Adjustment Stok', 'kartu-stok': 'Kartu Stok', pengambilan: 'Pengambilan Barang', ai: 'AI Search Barang', menus: 'Menu', dashboard: 'Dashboard', shift: 'Closing Shift' };
const ignored = new Set(['/api/v1/health', '/api/v1/settings/runtime', '/api/v1/auth/session', '/api/v1/log-activity']);

export function describeActivity(req, status, body) {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  if (!path.startsWith('/api/v1/') || (ignored.has(path) && status < 400) || req.method === 'OPTIONS') return null;
  const [resource, segment] = path.slice('/api/v1/'.length).split('/');
  const modul = modules[resource] || 'Aplikasi';
  let aksi = ({ GET: 'Lihat', POST: 'Tambah', PUT: 'Edit', PATCH: 'Edit', DELETE: 'Hapus' })[req.method] || 'Akses';
  if (resource === 'auth') aksi = segment === 'logout' ? 'Logout' : segment === 'session' ? 'Validasi Sesi' : body?.requires_2fa || segment === 'verify-otp' ? 'Verifikasi' : 'Login';
  else if (segment === 'backup') aksi = 'Backup';
  else if (segment === 'test-email') aksi = 'Uji Email';
  else if (segment === 'kode-otomatis' || segment === 'barcode-otomatis') aksi = 'Generate';
  else if (segment === 'scan' || segment === 'items') aksi = 'Scan';
  else if (resource === 'ai') aksi = 'Cari';
  else if (req.method === 'GET' && req.query?.search) aksi = 'Cari';
  const filters = ['search', 'page', 'limit', 'tipe', 'barang_id', 'rak_id'].filter(key => req.query?.[key] !== undefined)
    .map(key => `${key}=${String(req.query[key]).slice(0, 200)}`).join(', ');
  const detail = `${req.method} ${modules[resource] ? resource : 'endpoint'}${segment && /^[0-9]+$/.test(segment) ? ` ID ${segment}` : ''}${filters ? `; ${filters}` : ''}; HTTP ${status}`;
  const username = resource === 'auth' && segment === 'login' && status >= 400 && /^[A-Za-z0-9._@-]{1,100}$/.test(req.body?.username || '') ? `; username percobaan ${req.body.username}` : '';
  return { req, aksi: status >= 400 ? `Gagal ${aksi}` : aksi, modul, detail: detail + username };
}

// Await recording before the JSON response reaches the client, so opening the
// activity list immediately after a successful action includes that action.
export function activityAudit({ record = safeLogActivity } = {}) {
  return (req, res, next) => {
    const json = res.json;
    res.json = function(body) {
      const entry = describeActivity(req, res.statusCode, body);
      if (!entry || (req.activityLogged && (res.statusCode < 400 || req.activityLoggedFailure)) || req.activityAuditPending) return json.call(this, body);
      req.activityAuditPending = true;
      const send = () => res.destroyed || res.writableEnded ? res : json.call(res, body);
      Promise.resolve().then(() => record(entry)).then(send, send).catch(next);
      return this;
    };
    next();
  };
}
