import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { verifyToken } from './authService.js';

const useTestStore = process.env.NODE_ENV === 'test';
let logColumnCache;

async function logColumns() {
  if (logColumnCache) return logColumnCache;
  const result = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='log_activity'
       AND column_name IN ('user_id', 'user_name')`,
  );
  logColumnCache = new Set(result.rows.map((row) => row.column_name));
  return logColumnCache;
}

async function actorName(userId) {
  if (!userId) return 'System';
  const result = await query('SELECT COALESCE(nama, username, $2) AS name FROM users WHERE id=$1', [userId, 'System']);
  return result.rows[0]?.name || 'System';
}

export function requestUserId(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const payload = token ? verifyToken(token) : null;
  const id = Number(payload?.sub);
  if (Number.isSafeInteger(id) && id > 0) return id;
  const fallbackId = Number(req.headers['x-user-id']);
  return Number.isSafeInteger(fallbackId) && fallbackId > 0 ? fallbackId : null;
}

function requestUserName(req) {
  const value = req?.headers?.['x-user-name'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;
}

export async function logActivity({ req, userId, aksi, modul, detail }) {
  const actorId = userId ?? requestUserId(req || {});
  const actorFallbackName = requestUserName(req);
  const ip = req?.ip || null;

  if (useTestStore) {
    await updateStore((store) => {
      store.log_activity ||= [];
      store.log_activity.unshift({
        id: Math.max(0, ...store.log_activity.map((row) => Number(row.id) || 0)) + 1,
        waktu: new Date().toISOString(),
        user_id: actorId,
        aksi,
        modul,
        detail,
        ip,
      });
    });
    return;
  }

  const columns = ['aksi', 'modul', 'detail', 'ip'];
  const values = [aksi, modul, detail, ip];
  const existingColumns = await logColumns();
  if (existingColumns.has('user_id')) {
    columns.unshift('user_id');
    values.unshift(actorId);
  }
  if (existingColumns.has('user_name')) {
    columns.unshift('user_name');
    values.unshift(actorFallbackName || await actorName(actorId));
  }

  await query(
    `INSERT INTO log_activity(${columns.join(', ')})
     VALUES(${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
    values,
  );
}

export function safeLogActivity(payload) {
  return logActivity(payload).catch((error) => {
    console.error('Gagal mencatat log activity', error);
  });
}

export async function listActivities(search = '') {
  const term = search.trim().toLowerCase();
  if (useTestStore) {
    const store = await readStore();
    return (store.log_activity || [])
      .map((row) => ({
        ...row,
        user_detail: (store.users || store.pengguna || []).find((user) => Number(user.id) === Number(row.user_id)) || null,
      }))
      .filter((row) => !term || `${row.aksi} ${row.modul || ''} ${row.detail || ''} ${row.user_detail?.nama || ''}`.toLowerCase().includes(term));
  }

  const existingColumns = await logColumns();
  const hasUserId = existingColumns.has('user_id');
  const hasUserName = existingColumns.has('user_name');
  return (await query(
    `SELECT a.id, a.waktu, ${hasUserId ? 'a.user_id' : 'NULL::bigint AS user_id'}, a.aksi, a.modul, a.detail, a.ip, a.created_at,
      ${hasUserId ? "json_build_object('id',u.id,'username',u.username,'nama',u.nama)" : `json_build_object('id',NULL,'username',NULL,'nama',${hasUserName ? 'a.user_name' : 'NULL'})`} AS user_detail
     FROM log_activity a
     ${hasUserId ? 'LEFT JOIN users u ON u.id=a.user_id' : ''}
     WHERE $1 = '' OR a.aksi ILIKE '%' || $1 || '%' OR a.modul ILIKE '%' || $1 || '%' OR a.detail ILIKE '%' || $1 || '%' ${hasUserId ? "OR u.nama ILIKE '%' || $1 || '%'" : hasUserName ? "OR a.user_name ILIKE '%' || $1 || '%'" : ''}
     ORDER BY a.waktu DESC, a.id DESC`,
    [search.trim()],
  )).rows;
}
