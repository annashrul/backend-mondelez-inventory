import { HttpError } from '../middleware/errors.js';
import { sendPengambilanEmail } from './emailService.js';
import { notificationPagination, notificationPage } from '../utils/notificationPagination.js';
import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { verifyToken } from './authService.js';

const useTestStore = process.env.NODE_ENV === 'test';
const settingKey = 'pengambilan_barang';
let schemaReady;
let ioInstance = null;

async function ensureSchema() {
  if (useTestStore) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS notification_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS notifications (
        id bigserial PRIMARY KEY,
        type text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by bigint NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS notification_recipients (
        notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(notification_id, user_id)
      )`);
    })();
  }
  await schemaReady;
}

function normalizeSetting(value = {}) {
  return {
    email_enabled: value.email_enabled === true,
    stock_enabled: value.stock_enabled !== false,
    transaction_enabled: value.transaction_enabled !== false,
    level_ids: Array.isArray(value.level_ids) ? value.level_ids.map(Number).filter(Boolean) : [],
    user_ids: Array.isArray(value.user_ids) ? value.user_ids.map(Number).filter(Boolean) : [],
  };
}

export function userIdFromToken(token) {
  const payload = token ? verifyToken(token) : null;
  const tokenId = Number(payload?.sub);
  return Number.isSafeInteger(tokenId) && tokenId > 0 ? tokenId : null;
}

function userIdFromRequest(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token;
  const tokenId = userIdFromToken(token);
  if (Number.isSafeInteger(tokenId) && tokenId > 0) return tokenId;
  const fallbackId = Number(req.headers['x-user-id']);
  return Number.isSafeInteger(fallbackId) && fallbackId > 0 ? fallbackId : null;
}

async function defaultAdminLevelIds() {
  if (useTestStore) {
    const store = await readStore();
    return (store.level_pengguna || store.levels || [])
      .filter((level) => String(level.nama || '').toLowerCase() === 'admin')
      .map((level) => Number(level.id));
  }
  const result = await query(`SELECT id FROM levels WHERE LOWER(nama)='admin'`);
  return result.rows.map((row) => Number(row.id));
}

export async function getNotificationSetting() {
  if (useTestStore) {
    const store = await readStore();
    return normalizeSetting(store.notification_settings?.[settingKey] || { level_ids: await defaultAdminLevelIds(), user_ids: [] });
  }
  await ensureSchema();
  const result = await query('SELECT value FROM notification_settings WHERE key=$1', [settingKey]);
  if (!result.rowCount) return normalizeSetting({ level_ids: await defaultAdminLevelIds(), user_ids: [] });
  return normalizeSetting(result.rows[0].value);
}

export async function saveNotificationSetting(value) {
  if (['email_enabled', 'stock_enabled', 'transaction_enabled'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) {
    throw new HttpError(422, 'Status notifikasi email harus boolean');
  }
  const current = await getNotificationSetting();
  const setting = normalizeSetting({ ...current, ...value });
  if (useTestStore) {
    await updateStore((store) => {
      store.notification_settings ||= {};
      store.notification_settings[settingKey] = setting;
    });
    return setting;
  }
  await ensureSchema();
  await query(
    `INSERT INTO notification_settings(key, value, updated_at)
     VALUES($1, $2::jsonb, now())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [settingKey, JSON.stringify(setting)],
  );
  return setting;
}

async function resolveRecipientUsers(setting) {
  if (useTestStore) {
    const store = await readStore();
    return (store.pengguna || store.users || [])
      .filter((user) => user.status === 'Aktif')
      .filter((user) => setting.user_ids.includes(Number(user.id)) || setting.level_ids.includes(Number(user.level_id)));
  }
  const result = await query(
    `SELECT DISTINCT u.id,u.email,u.nama
     FROM users u
     WHERE u.status='Aktif'
       AND (u.id=ANY($1::bigint[]) OR u.level_id=ANY($2::bigint[]))`,
    [setting.user_ids, setting.level_ids],
  );
  return result.rows;
}

export async function resolvePengambilanRecipients() {
  return (await resolveRecipientUsers(await getNotificationSetting())).map(user => Number(user.id));
}

export function setNotificationSocket(io) {
  ioInstance = io;
}

function emitToUser(userId, notification) {
  ioInstance?.to(`user:${Number(userId)}`).emit('notification:new', notification);
}

async function persistNotification({ recipients, type, title, message, data, createdBy }) {
  let notification;
  if (useTestStore) {
    await updateStore(store => {
      store.notifications ||= []; store.notification_recipients ||= [];
      const id = Math.max(0, ...store.notifications.map(row => Number(row.id) || 0)) + 1;
      notification = { id, type, title, message, data, created_by: createdBy, created_at: new Date().toISOString(), read_at: null };
      store.notifications.unshift(notification);
      recipients.forEach(userId => store.notification_recipients.unshift({ notification_id: id, user_id: userId, read_at: null }));
    });
  } else {
    await ensureSchema();
    const result = await query(`INSERT INTO notifications(type,title,message,data,created_by)
      VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id,type,title,message,data,created_by,created_at`, [type,title,message,JSON.stringify(data),createdBy]);
    notification = { ...result.rows[0], read_at: null };
    await query(`INSERT INTO notification_recipients(notification_id,user_id)
      SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [notification.id,recipients]);
  }
  recipients.forEach(userId => emitToUser(userId,notification));
  return notification;
}
export async function createPengambilanNotification({ transaction, stokAkhir, createdBy, adjustment = false }, { sendEmail = sendPengambilanEmail } = {}) {
  const setting = await getNotificationSetting();
  const users = await resolveRecipientUsers(setting);
  const recipients = users.map(user => Number(user.id));
  if (!recipients.length) return null;
  const barang = transaction.barang_detail || {};
  const operator = transaction.operator_detail || {};
  const data = { no_ref: transaction.no_ref, transaction_id: transaction.id, barang_id: transaction.barang_id,
    barang_nama: barang.nama, qty: transaction.qty, pemohon: transaction.pemohon, stok_akhir: stokAkhir };
  let notification = null;
  if (setting.transaction_enabled) {
    notification = await persistNotification({ recipients, createdBy, data,
      type: adjustment ? 'adjustment_stok' : 'pengambilan_barang',
      title: adjustment ? 'Adjustment stok baru' : 'Pengambilan barang baru',
      message: adjustment ? `${barang.nama || 'Barang'}: ${transaction.tipe} ${transaction.qty}, saldo ${stokAkhir}`
        : `${operator.nama || operator.username || 'Operator'} memproses ${barang.nama || 'barang'} sebanyak ${transaction.qty} untuk ${transaction.pemohon}` });
  }
  const minimum = Number(barang.stok_min);
  const reduced = !adjustment || transaction.tipe === 'Kurang';
  if (setting.stock_enabled && reduced && Number.isFinite(minimum) && Number(stokAkhir) <= minimum && Number(stokAkhir)+Number(transaction.qty) > minimum) {
    const alert = await persistNotification({ recipients, createdBy, data, type: 'stok_minimum',
      title: 'Stok mencapai batas minimum', message: `${barang.nama || 'Barang'} tersisa ${stokAkhir}, batas minimum ${minimum}` });
    notification ||= alert;
  }
  if (setting.email_enabled && !adjustment) {
    try {
      const result = await sendEmail(users, transaction, stokAkhir);
      console.log(JSON.stringify({ event: 'notification_email', notification_id: notification?.id || null, ...result }));
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SMTP_ERROR';
      console.error(JSON.stringify({ event: 'notification_email', notification_id: notification?.id || null, status: 'failed', code }));
    }
  }
  return notification;
}

export async function listNotifications(req) {
  const userId = userIdFromRequest(req);
  const { limit, cursor } = notificationPagination(req.query);
  if (!userId) return notificationPage([], 0, limit);

  if (useTestStore) {
    const store = await readStore();
    const rows = (store.notification_recipients || [])
      .filter((row) => Number(row.user_id) === Number(userId))
      .map((row) => ({ ...(store.notifications || []).find((item) => Number(item.id) === Number(row.notification_id)), read_at: row.read_at }))
      .filter((row) => row.id)
      .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
    const unread = rows.filter((row) => !row.read_at).length;
    const older = cursor ? rows.filter((row) => BigInt(row.id) < BigInt(cursor)) : rows;
    return notificationPage(older.slice(0, limit + 1), unread, limit);
  }

  await ensureSchema();
  const result = await query(
    `SELECT n.id,n.type,n.title,n.message,n.data,n.created_by,n.created_at,r.read_at
     FROM notification_recipients r
     JOIN notifications n ON n.id=r.notification_id
     WHERE r.user_id=$1 AND ($2::bigint IS NULL OR n.id < $2::bigint)
     ORDER BY n.id DESC
     LIMIT $3`,
    [userId, cursor, limit + 1],
  );
  const count = await query(
    'SELECT COUNT(*)::integer AS unread FROM notification_recipients WHERE user_id=$1 AND read_at IS NULL',
    [userId],
  );
  return notificationPage(result.rows, Number(count.rows[0].unread), limit);
}

export async function markNotificationsRead(req, notificationId = null) {
  const userId = userIdFromRequest(req);
  if (!userId) return 0;
  if (useTestStore) {
    let count = 0;
    await updateStore((store) => {
      (store.notification_recipients || []).forEach((row) => {
        if (Number(row.user_id) === Number(userId) && (!notificationId || Number(row.notification_id) === Number(notificationId)) && !row.read_at) {
          row.read_at = new Date().toISOString();
          count += 1;
        }
      });
    });
    return count;
  }
  await ensureSchema();
  const result = await query(
    `UPDATE notification_recipients SET read_at=COALESCE(read_at, now())
     WHERE user_id=$1 AND ($2::bigint IS NULL OR notification_id=$2) AND read_at IS NULL`,
    [userId, notificationId],
  );
  return result.rowCount;
}
