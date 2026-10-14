import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { HttpError } from '../middleware/errors.js';

export const defaultSettings = {
  nama_perusahaan: 'Mondelez Inventory', alamat: '', telepon: '', email: '',
  tema: 'light', bahasa: 'id', items_per_page: 10,
  auto_backup: false, session_timeout: 30, two_factor: false,
};
export const settingSections = {
  umum: ['nama_perusahaan', 'alamat', 'telepon', 'email'],
  tampilan: ['tema', 'bahasa', 'items_per_page'],
  database: ['auto_backup'], keamanan: ['session_timeout', 'two_factor'],
};
let schema;
let cached;
let cachedAt = 0;
let settingsSocket;
export function setSettingsSocket(io) { settingsSocket = io; }
export async function ensureSettingsSchema() {
  if (process.env.NODE_ENV === 'test') return;
  schema ||= query(`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`).catch(error => { schema = null; throw error; });
  await schema;
}
export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < 5000) return { ...cached };
  let value;
  if (process.env.NODE_ENV === 'test') value = (await readStore()).app_settings || {};
  else {
    await ensureSettingsSchema();
    value = (await query("SELECT value FROM app_settings WHERE key='global'")).rows[0]?.value || {};
  }
  cached = { ...defaultSettings, ...value }; cachedAt = Date.now();
  return { ...cached };
}
export function validateSettings(section, body) {
  const keys = settingSections[section];
  if (!keys || !body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'Bagian pengaturan tidak valid');
  const value = {};
  for (const key of keys) {
    if (body[key] === undefined) continue;
    const item = body[key];
    if (['auto_backup', 'two_factor'].includes(key)) {
      if (typeof item !== 'boolean') throw new HttpError(422, `${key} harus boolean`);
    } else if (['items_per_page', 'session_timeout'].includes(key)) {
      const min = key === 'session_timeout' ? 1 : 5;
      const max = key === 'session_timeout' ? 1440 : 100;
      if (!Number.isInteger(item) || item < min || item > max) throw new HttpError(422, `${key} harus ${min} sampai ${max}`);
    } else if (typeof item !== 'string' || item.length > (key === 'alamat' ? 1000 : 254)) throw new HttpError(422, `${key} tidak valid`);
    value[key] = typeof item === 'string' ? item.trim() : item;
  }
  if ('nama_perusahaan' in value && !value.nama_perusahaan) throw new HttpError(422, 'Nama perusahaan wajib diisi');
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw new HttpError(422, 'Email perusahaan tidak valid');
  if (value.tema && !['light', 'dark'].includes(value.tema)) throw new HttpError(422, 'Tema tidak valid');
  if (value.bahasa && !['id', 'en'].includes(value.bahasa)) throw new HttpError(422, 'Bahasa tidak valid');
  return value;
}
export async function saveSettings(section, body) {
  const value = validateSettings(section, body);
  if (process.env.NODE_ENV === 'test') await updateStore(store => { store.app_settings = { ...store.app_settings, ...value }; });
  else {
    await ensureSettingsSchema();
    await query(`INSERT INTO app_settings(key,value) VALUES('global',$1::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=app_settings.value || EXCLUDED.value,updated_at=now()`, [JSON.stringify(value)]);
  }
  cached = null;
  const result = await getSettings({ fresh: true });
  const { tema, bahasa, items_per_page, nama_perusahaan, alamat, telepon, email, session_timeout } = result;
  settingsSocket?.emit('settings:updated', { tema, bahasa, items_per_page, nama_perusahaan, alamat, telepon, email, session_timeout });
  return result;
}
