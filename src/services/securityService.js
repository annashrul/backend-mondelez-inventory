import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { getSettings } from './settingsService.js';
import { HttpError } from '../middleware/errors.js';
import { sendLoginCode } from './emailService.js';

let schema;
async function ensureSchema() {
  if (process.env.NODE_ENV === 'test') return;
  schema ||= (async () => {
    await query(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id uuid PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_seen timestamptz NOT NULL DEFAULT now()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS login_challenges (
      id uuid PRIMARY KEY, user_id bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, code_hash text NOT NULL,
      expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz
    )`);
    await query('CREATE UNIQUE INDEX IF NOT EXISTS login_challenges_user_unique ON login_challenges(user_id)');
  })().catch(error => { schema = null; throw error; });
  await schema;
}
const hash = (id, code) => createHmac('sha256', process.env.AUTH_SECRET || 'development-only-change-me').update(`${id}:${code}`).digest('hex');
export async function createSession(userId) {
  const id = randomUUID();
  if (process.env.NODE_ENV === 'test') await updateStore(store => {
    store.auth_sessions ||= []; store.auth_sessions.push({ id, user_id: Number(userId), last_seen: new Date().toISOString() });
  });
  else {
    await ensureSchema();
    await query("DELETE FROM auth_sessions WHERE last_seen < now()-interval '2 days'");
    await query('INSERT INTO auth_sessions(id,user_id) VALUES($1,$2)', [id, userId]);
  }
  return id;
}
export async function validateSession(payload, touch = true) {
  if (!payload?.sid) return true; // Existing signed tokens retain their original expiry.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sid)) return false;
  const timeout = (await getSettings()).session_timeout;
  if (process.env.NODE_ENV === 'test') {
    let valid = false;
    await updateStore(store => {
      const session = store.auth_sessions?.find(row => row.id === payload.sid && String(row.user_id) === String(payload.sub));
      valid = Boolean(session && Date.now()-new Date(session.last_seen).getTime() < timeout*60000);
      if (valid && touch) session.last_seen = new Date().toISOString();
    });
    return valid;
  }
  await ensureSchema();
  const sql = touch
    ? `UPDATE auth_sessions SET last_seen=now() WHERE id=$1 AND user_id=$2 AND last_seen > now()-($3::int * interval '1 minute') RETURNING id`
    : `SELECT id FROM auth_sessions WHERE id=$1 AND user_id=$2 AND last_seen > now()-($3::int * interval '1 minute')`;
  return Boolean((await query(sql, [payload.sid, payload.sub, timeout])).rowCount);
}
export async function removeSession(id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  if (process.env.NODE_ENV === 'test') await updateStore(store => { store.auth_sessions = (store.auth_sessions || []).filter(row => row.id !== id); });
  else { await ensureSchema(); await query('DELETE FROM auth_sessions WHERE id=$1', [id]); }
}
export async function beginLoginChallenge(user, { send = sendLoginCode } = {}) {
  if (!user.email) throw new HttpError(422, 'Alamat email akun admin belum diisi');
  if (process.env.NODE_ENV === 'test') {
    const previous = (await readStore()).login_challenges?.find(row => row.user_id === Number(user.id));
    if (previous && new Date(previous.expires_at).getTime()-Date.now() > 240000) throw new HttpError(429, 'Tunggu satu menit sebelum meminta kode login lagi');
  } else {
    await ensureSchema();
    const recent = await query("SELECT id FROM login_challenges WHERE user_id=$1 AND expires_at > now()+interval '4 minutes'", [user.id]);
    if (recent.rowCount) throw new HttpError(429, 'Tunggu satu menit sebelum meminta kode login lagi');
  }
  const id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  const row = { id, user_id: Number(user.id), code_hash: hash(id, code), expires_at: new Date(Date.now()+300000).toISOString(), attempts: 0, consumed_at: null };
  if (process.env.NODE_ENV === 'test') await updateStore(store => {
    const previous = store.login_challenges?.find(item => item.user_id === Number(user.id));
    if (previous && new Date(previous.expires_at).getTime()-Date.now() > 240000) throw new HttpError(429, 'Tunggu satu menit sebelum meminta kode login lagi');
    store.login_challenges = (store.login_challenges || []).filter(item => item.user_id !== Number(user.id));
    store.login_challenges.push(row);
  });
  else {
    await ensureSchema();
    await query('DELETE FROM login_challenges WHERE expires_at < now()');
    const inserted = await query(`INSERT INTO login_challenges(id,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET id=EXCLUDED.id,code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0,consumed_at=NULL
      WHERE login_challenges.expires_at <= now()+interval '4 minutes' RETURNING id`, [id,user.id,row.code_hash,row.expires_at]);
    if (!inserted.rowCount) throw new HttpError(429, 'Tunggu satu menit sebelum meminta kode login lagi');
  }
  try { await send(user.email, code); } catch {
    // Invalidate undelivered codes; no login token is issued.
    if (process.env.NODE_ENV === 'test') await updateStore(store => { store.login_challenges = store.login_challenges.filter(item => item.id !== id); });
    else await query('DELETE FROM login_challenges WHERE id=$1', [id]);
    throw new HttpError(503, 'Kode login gagal dikirim. Periksa konfigurasi email server.');
  }
  return { requires_2fa: true, challenge_id: id, message: 'Kode verifikasi telah dikirim ke email akun Anda. Berlaku 5 menit.' };
}
export async function consumeLoginChallenge(id, code) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id)) || !/^[0-9]{6}$/.test(String(code))) throw new HttpError(422, 'Kode verifikasi tidak valid');
  let userId = null;
  const matches = row => {
    const actual = Buffer.from(hash(id, code)); const expected = Buffer.from(row.code_hash);
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  };
  if (process.env.NODE_ENV === 'test') {
    await updateStore(store => {
      const row = store.login_challenges?.find(item => item.id === id);
      if (!row || row.consumed_at || row.attempts >= 5 || new Date(row.expires_at).getTime() <= Date.now()) return;
      row.attempts++;
      if (matches(row)) { row.consumed_at = new Date().toISOString(); userId = row.user_id; }
    });
  } else {
    await ensureSchema();
    const result = await query(`UPDATE login_challenges SET attempts=attempts+1
      WHERE id=$1 AND consumed_at IS NULL AND attempts<5 AND expires_at>now() RETURNING *`, [id]);
    const row = result.rows[0];
    if (row && matches(row)) {
      const consumed = await query('UPDATE login_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING user_id', [id]);
      userId = consumed.rows[0]?.user_id;
    }
  }
  if (!userId) throw new HttpError(401, 'Kode salah, kedaluwarsa, atau sudah digunakan. Login ulang untuk meminta kode baru.');
  return userId;
}
