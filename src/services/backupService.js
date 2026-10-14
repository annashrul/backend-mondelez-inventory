import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, unlink, open, copyFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { ensureSettingsSchema, getSettings } from './settingsService.js';
import { HttpError } from '../middleware/errors.js';

const execute = promisify(execFile);
let running = false;
let timer;
async function backupMetadata(value) {
  if (process.env.NODE_ENV === 'test') {
    if (value) await updateStore(store => { store.backup_status = value; });
    return (await readStore()).backup_status || null;
  }
  await ensureSettingsSchema();
  if (value) await query(`INSERT INTO app_settings(key,value) VALUES('backup',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [JSON.stringify(value)]);
  return (await query("SELECT value FROM app_settings WHERE key='backup'")).rows[0]?.value || null;
}
export async function getBackupStatus() {
  let available = process.env.NODE_ENV === 'test';
  if (!available) {
    try { await execute('pg_dump', ['--version'], { timeout: 3000 }); available = true; } catch { available = false; }
  }
  return { backup: await backupMetadata(), backup_available: available, backup_running: running };
}
export async function runBackup() {
  if (running) throw new HttpError(409, 'Backup sedang berjalan');
  running = true;
  let target;
  try {
    const directory = path.resolve(process.env.BACKUP_DIR || './.backups');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const timestamp = new Date().toISOString();
    const filename = `inventory-${timestamp.replace(/[:.]/g, '-')}-${randomUUID()}.dump`;
    target = path.join(directory, filename);
    const file = await open(target, 'wx', 0o600); await file.close();
    if (process.env.NODE_ENV === 'test') await copyFile(process.env.DATA_FILE, target);
    else {
      const connection = process.env.DIRECT_URL || process.env.DATABASE_URL;
      if (!connection) throw new Error('Database unavailable');
      await execute('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', target], {
        env: { ...process.env, PGDATABASE: connection }, timeout: 600000, maxBuffer: 65536,
      });
    }
    await chmod(target, 0o600);
    const status = { status: 'success', timestamp, filename };
    await backupMetadata(status);
    const files = (await readdir(directory)).filter(name => /^inventory-[0-9TZa-f-]+\.dump$/.test(name)).sort().reverse();
    for (const name of files.slice(7)) await unlink(path.join(directory, name));
    return status;
  } catch {
    if (target) await unlink(target).catch(() => {});
    const status = { status: 'failed', timestamp: new Date().toISOString() };
    await backupMetadata(status).catch(() => {});
    console.error(JSON.stringify({ event: 'database_backup', status: 'failed' }));
    throw new HttpError(503, 'Backup gagal. Periksa pg_dump, koneksi database, dan izin direktori backup server.');
  } finally { running = false; }
}
export async function checkScheduledBackup() {
  const settings = await getSettings();
  if (!settings.auto_backup || running) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const last = await backupMetadata();
  if (last?.status === 'failed' && Date.now()-new Date(last.timestamp).getTime() < 3600000) return;
  const lastDay = last?.status === 'success' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(last.timestamp)) : null;
  if (today !== lastDay) await runBackup();
}
export function startBackupScheduler() {
  if (timer || process.env.NODE_ENV === 'test') return;
  timer = setInterval(() => checkScheduledBackup().catch(() => {}), 300000);
  timer.unref();
}
