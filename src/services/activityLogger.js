import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { verifyToken } from './authService.js';

const useTestStore = process.env.NODE_ENV === 'test';
let logColumnCache;

async function logColumns() {
  if (logColumnCache) return logColumnCache;
  const result = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='activity_logs'
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
  const token = req?.headers?.authorization?.replace(/^Bearer\s+/i, '');
  let payload;
  try { payload = token ? verifyToken(token) : null; } catch { return null; }
  const id = Number(payload?.sub);
  if (Number.isSafeInteger(id) && id > 0) return id;
  return null;
}

export async function logActivity({ req, userId, action, module, detail }) {
  const actorId = userId ?? requestUserId(req || {});
  const ip = req?.ip || null;

  if (useTestStore) {
    await updateStore((store) => {
      store.activity_logs ||= [];
      store.activity_logs.unshift({
        id: Math.max(0, ...store.activity_logs.map((row) => Number(row.id) || 0)) + 1,
        occurred_at: new Date().toISOString(),
        user_id: actorId,
        action,
        module,
        detail,
        ip,
      });
    });
    if (req) { req.activityLogged = true; req.activityLoggedFailure = String(action).startsWith('Gagal') || action === 'Ditolak Akses'; }
    return;
  }

  const columns = ['action', 'module', 'detail', 'ip'];
  const values = [action, module, detail, ip];
  const existingColumns = await logColumns();
  if (existingColumns.has('user_id')) {
    columns.unshift('user_id');
    values.unshift(actorId);
  }
  if (existingColumns.has('user_name')) {
    columns.unshift('user_name');
    values.unshift(await actorName(actorId));
  }

  await query(
    `INSERT INTO activity_logs(${columns.join(', ')})
     VALUES(${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
    values,
  );
  if (req) { req.activityLogged = true; req.activityLoggedFailure = String(action).startsWith('Gagal') || action === 'Ditolak Akses'; }
}

export function safeLogActivity(payload) {
  return logActivity(payload).catch((error) => {
    console.error(JSON.stringify({ event: 'activity_log_failed', code: /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'AUDIT_ERROR' }));
  });
}

export async function listActivities(search = '') {
  const term = search.trim().toLowerCase();
  if (useTestStore) {
    const store = await readStore();
    return (store.activity_logs || [])
      .map((row) => ({
        ...row,
        user_detail: (store.users || []).find((user) => Number(user.id) === Number(row.user_id)) || null,
      }))
      .filter((row) => !term || `${row.action} ${row.module || ''} ${row.detail || ''} ${row.user_detail?.nama || ''}`.toLowerCase().includes(term));
  }

  const existingColumns = await logColumns();
  const hasUserId = existingColumns.has('user_id');
  const hasUserName = existingColumns.has('user_name');
  return (await query(
    `SELECT a.id, a.occurred_at, ${hasUserId ? 'a.user_id' : 'NULL::bigint AS user_id'}, a.action, a.module, a.detail, a.ip, a.created_at,
      ${hasUserId ? "json_build_object('id',u.id,'username',u.username,'nama',u.nama)" : `json_build_object('id',NULL,'username',NULL,'nama',${hasUserName ? 'a.user_name' : 'NULL'})`} AS user_detail
     FROM activity_logs a
     ${hasUserId ? 'LEFT JOIN users u ON u.id=a.user_id' : ''}
     WHERE $1 = '' OR a.action ILIKE '%' || $1 || '%' OR a.module ILIKE '%' || $1 || '%' OR a.detail ILIKE '%' || $1 || '%' ${hasUserId ? "OR u.nama ILIKE '%' || $1 || '%'" : hasUserName ? "OR a.user_name ILIKE '%' || $1 || '%'" : ''}
     ORDER BY a.occurred_at DESC, a.id DESC`,
    [search.trim()],
  )).rows;
}
