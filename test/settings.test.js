import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(os.tmpdir(), 'inventory-settings-'));
process.env.DATA_FILE = path.join(directory, 'inventory.json');
process.env.BACKUP_DIR = path.join(directory, 'backups');
await writeFile(process.env.DATA_FILE, JSON.stringify({
  levels: [{ id: 1, nama: 'Admin' }],
  users: [{ id: 1, email: 'admin@example.test', status: 'Aktif', level_id: 1 }],
  notification_settings: { pengambilan_barang: { level_ids: [1], user_ids: [], email_enabled: false } },
}));
const { defaultSettings, getSettings, saveSettings, validateSettings, setSettingsSocket } = await import('../src/services/settingsService.js');
const { createSession, validateSession, removeSession, beginLoginChallenge, consumeLoginChallenge } = await import('../src/services/securityService.js');
const { saveNotificationSetting, createPengambilanNotification } = await import('../src/services/notificationService.js');
const { runBackup, getBackupStatus, checkScheduledBackup, pgDumpEnvironment } = await import('../src/services/backupService.js');
const { readStore, updateStore } = await import('../src/config/store.js');
after(() => rm(directory, { recursive: true, force: true }));

test('all setting sections have safe defaults and persistence', async () => {
  assert.deepEqual(await getSettings(), defaultSettings);
  await saveSettings('umum', { nama_perusahaan: 'Test Inventory', email: 'office@example.test', alamat: 'Jakarta', telepon: '123' });
  await saveSettings('tampilan', { tema: 'dark', bahasa: 'en', items_per_page: 25, nama_perusahaan: 'Ignored section field' });
  await saveSettings('keamanan', { session_timeout: 10 });
  const value = await getSettings({ fresh: true });
  assert.equal(value.nama_perusahaan, 'Test Inventory');
  assert.equal(value.tema, 'dark');
  assert.equal(value.bahasa, 'en');
  assert.equal(value.items_per_page, 25);
  assert.equal(value.session_timeout, 10);
  assert.equal((await readStore()).app_settings.email, 'office@example.test');
});

test('invalid settings cannot be persisted', () => {
  for (const [section, body] of [
    ['other', {}], ['umum', { nama_perusahaan: '' }], ['umum', { email: 'invalid' }],
    ['tampilan', { tema: 'other' }], ['tampilan', { bahasa: 'other' }],
    ['tampilan', { items_per_page: 0 }], ['tampilan', { items_per_page: 101 }],
    ['tampilan', { items_per_page: 1.5 }], ['keamanan', { session_timeout: 0 }],
    ['keamanan', { session_timeout: 1441 }], ['keamanan', { two_factor: 'true' }],
    ['database', { auto_backup: 1 }],
  ]) assert.throws(() => validateSettings(section, body), error => error.status === 422);
});

test('saved runtime preferences are broadcast without security flags', async () => {
  const events = [];
  setSettingsSocket({ emit: (event, value) => events.push({ event, value }) });
  await saveSettings('tampilan', { items_per_page: 30 });
  assert.equal(events[0].event, 'settings:updated');
  assert.equal(events[0].value.items_per_page, 30);
  assert.equal(events[0].value.two_factor, undefined);
  setSettingsSocket(null);
});

test('database sessions enforce idle timeout and logout invalidates them', async () => {
  const sid = await createSession(1);
  const payload = { sub: '1', sid };
  assert.equal(await validateSession(payload), true);
  assert.equal(await validateSession({ ...payload, sub: '2' }), false);
  await updateStore(store => { store.auth_sessions[0].last_seen = new Date(Date.now()-11*60000).toISOString(); });
  assert.equal(await validateSession(payload), false);
  const live = await createSession(1);
  await removeSession(live);
  assert.equal(await validateSession({ sub: '1', sid: live }), false);
  assert.equal(await validateSession({ sub: '1' }), true);
});

test('OTP codes are hashed, delivered to the account email, and consumed once', async () => {
  let delivered;
  const challenge = await beginLoginChallenge({ id: 1, email: 'admin@example.test' }, { send: async (email, code) => { delivered = { email, code }; } });
  assert.equal(challenge.requires_2fa, true);
  assert.equal(challenge.token, undefined);
  assert.equal(delivered.email, 'admin@example.test');
  const row = (await readStore()).login_challenges[0];
  assert.notEqual(row.code_hash, delivered.code);
  assert.equal(await consumeLoginChallenge(challenge.challenge_id, delivered.code), 1);
  await assert.rejects(consumeLoginChallenge(challenge.challenge_id, delivered.code), error => error.status === 401);
  await assert.rejects(beginLoginChallenge({ id: 1, email: 'admin@example.test' }, { send: async () => {} }), error => error.status === 429);
});

test('OTP expiry and attempt limits prevent later correct codes from logging in', async () => {
  for (const userId of [2, 3]) {
    let code;
    const challenge = await beginLoginChallenge({ id: userId, email: 'admin@example.test' }, { send: async (email, value) => { code=value; } });
    if (userId === 2) {
      await updateStore(store => { store.login_challenges.find(row => row.id === challenge.challenge_id).expires_at = new Date(Date.now()-1).toISOString(); });
    } else {
      const wrong = code === '000000' ? '999999' : '000000';
      for (let i=0;i<5;i++) await assert.rejects(consumeLoginChallenge(challenge.challenge_id,wrong), error => error.status === 401);
    }
    await assert.rejects(consumeLoginChallenge(challenge.challenge_id,code), error => error.status === 401);
  }
});

test('failed OTP delivery invalidates the stored challenge and exposes no credentials', async () => {
  await assert.rejects(beginLoginChallenge({ id: 4, email: 'admin@example.test' }, { send: async () => { throw new Error('SMTP_PASSWORD=secret'); } }), error => error.status === 503 && !error.message.includes('secret'));
  assert.equal((await readStore()).login_challenges.some(row => row.user_id === 4), false);
});

test('transaction and low stock notification toggles control emitted records independently', async () => {
  const payload = { transaction: { id: 10, no_ref: 'AMB-10', barang_id: 1, qty: 3, pemohon: 'Budi', barang_detail: { nama: 'Test Item', stok_min: 5 } }, stokAkhir: 4, createdBy: 1 };
  await saveNotificationSetting({ transaction_enabled: false, stock_enabled: false });
  assert.equal(await createPengambilanNotification(payload), null);
  await saveNotificationSetting({ stock_enabled: true });
  const low = await createPengambilanNotification(payload);
  assert.equal(low.type, 'stok_minimum');
  assert.equal((await readStore()).notifications.length, 1);
  assert.equal(await createPengambilanNotification({ ...payload, stokAkhir: 1 }), null);
  await saveNotificationSetting({ stock_enabled: false, transaction_enabled: true });
  assert.equal((await createPengambilanNotification(payload)).type, 'pengambilan_barang');
});

test('manual backup records status, retains seven files, and keeps snapshots private', async () => {
  for (let i=0;i<8;i++) await runBackup();
  const files = await readdir(process.env.BACKUP_DIR);
  assert.equal(files.length, 7);
  assert.equal((await stat(path.join(process.env.BACKUP_DIR,files[0]))).mode & 0o777, 0o600);
  const status = await getBackupStatus();
  assert.equal(status.backup.status, 'success');
  assert.equal(status.backup_available, true);
});

test('scheduled backup respects OFF and does not create duplicates on the same day', async () => {
  const before = (await getBackupStatus()).backup.filename;
  await saveSettings('database', { auto_backup: false });
  await checkScheduledBackup();
  assert.equal((await getBackupStatus()).backup.filename, before);
  await saveSettings('database', { auto_backup: true });
  await checkScheduledBackup();
  assert.equal((await getBackupStatus()).backup.filename, before);
});


test('HTTP settings endpoints enforce access, runtime privacy, and OTP/session lifecycle', async (t) => {
  const { default: app } = await import('../src/server.js');
  const { createToken } = await import('../src/services/authService.js');
  const { findUser } = await import('../src/repositories/accessRepository.js');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening',resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1`;
  const request = (endpoint, options = {}) => fetch(url+endpoint, { ...options, headers: { connection: 'close', ...options.headers } });
  assert.equal((await request('/settings')).status,401);
  const token = createToken(await findUser(1));
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await request('/settings', { headers })).status,200);
  assert.equal((await request('/settings/umum', { method: 'PUT', headers, body: JSON.stringify({ nama_perusahaan: 'HTTP Company' }) })).status,200);
  const runtime = await (await request('/settings/runtime')).json();
  assert.equal(runtime.nama_perusahaan,'HTTP Company');
  assert.equal(runtime.two_factor,undefined);
  assert.equal(runtime.auto_backup,undefined);
  assert.equal((await request('/settings/keamanan', { method: 'PUT', headers, body: JSON.stringify({ session_timeout: -1 }) })).status,422);
  await updateStore(store => { const row=store.login_challenges.find(item => item.user_id===1); row.expires_at=new Date(Date.now()+120000).toISOString(); });
  let code;
  const challenge = await beginLoginChallenge({ id: 1, email: 'admin@example.test' }, { send: async (email,value) => { code=value; } });
  const verified = await request('/auth/verify-otp', { method:'POST', headers: { 'Content-Type':'application/json' }, body:JSON.stringify({challenge_id:challenge.challenge_id,code}) });
  assert.equal(verified.status,200);
  const login = await verified.json();
  assert.ok(login.token);
  const authorized = { Authorization:`Bearer ${login.token}` };
  assert.equal((await request('/auth/session',{method:'POST',headers:authorized})).status,200);
  assert.equal((await request('/auth/logout',{method:'POST',headers:authorized})).status,200);
  assert.equal((await request('/menus',{headers:authorized})).status,401);
});


test('concurrent login code requests cannot send two emails for the same account', async () => {
  let sent = 0;
  const user = { id: 7, email: 'admin@example.test' };
  const options = { send: async () => { sent++; } };
  const results = await Promise.allSettled([beginLoginChallenge(user,options),beginLoginChallenge(user,options)]);
  assert.equal(sent,1);
  assert.equal(results.filter(result => result.status==='fulfilled').length,1);
  assert.equal(results.find(result => result.status==='rejected').reason.status,429);
});


test('pg_dump receives database fields instead of putting a connection URL into PGDATABASE', () => {
  const env = pgDumpEnvironment('postgresql://service.user:secret%20password@db.example.test:6543/inventory?sslmode=verify-full&options=-c%20statement_timeout%3D0', { PATH: '/usr/bin' });
  assert.equal(env.PGHOST,'db.example.test');
  assert.equal(env.PGPORT,'6543');
  assert.equal(env.PGDATABASE,'inventory');
  assert.equal(env.PGUSER,'service.user');
  assert.equal(env.PGPASSWORD,'secret password');
  assert.equal(env.PGSSLMODE,'verify-full');
  assert.equal(env.PGOPTIONS,'-c statement_timeout=0');
  assert.equal(env.PGCONNECT_TIMEOUT,'10');
  assert.equal(env.PATH,'/usr/bin');
  assert.equal(pgDumpEnvironment('postgres://user:password@db.example.test/postgres',{}).PGSSLMODE,'require');
  assert.throws(() => pgDumpEnvironment('https://example.test'));
});
