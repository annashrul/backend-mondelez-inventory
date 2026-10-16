import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(tmpdir(), 'inventory-audit-'));
process.env.DATA_FILE = path.join(directory, 'data.json');
process.env.BACKUP_DIR = path.join(directory, 'backups');
await writeFile(process.env.DATA_FILE, JSON.stringify({ ...(await import('../src/data/seed.js')).seedData, activity_logs: [], levels: [{ id: 1, nama: 'Admin' }], users: [{ id: 1, nama: 'Admin', level_id: 1, status: 'Aktif' }] }));
const { default: app } = await import('../src/server.js');
const { readStore } = await import('../src/config/store.js');
const { createToken } = await import('../src/services/authService.js');
const { findUser } = await import('../src/repositories/accessRepository.js');
const { settingsChanges } = await import('../src/utils/activityDetails.js');
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
const token = createToken(await findUser(1));
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', connection: 'close' };
async function request(endpoint, method = 'GET', data, customHeaders = headers) {
  const response = await fetch(base + endpoint, { method, headers: customHeaders, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}
const logs = async () => (await readStore()).activity_logs;
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });

test('settings and notification changes are recorded once with actor and before/after values before responding', async () => {
  assert.equal((await request('/settings/tampilan', 'PUT', { tema: 'dark', items_per_page: 5, password: 'DO_NOT_LOG' })).status, 200);
  const entries = await logs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].user_id, 1);
  assert.equal(entries[0].module, 'Pengaturan');
  assert.match(entries[0].detail, /Tema: light → dark/);
  assert.match(entries[0].detail, /Data per halaman: 10 → 5/);
  assert.doesNotMatch(JSON.stringify(entries), /DO_NOT_LOG/);
  assert.equal((await request('/notifications/settings', 'PUT', { email_enabled: true })).status, 200);
  assert.equal((await logs())[0].module, 'Pengaturan Notifikasi');
  assert.match((await logs())[0].detail, /Notifikasi email: Nonaktif → Aktif/);
});

test('failed saves, failed login, and read/search actions are also recorded safely', async () => {
  assert.equal((await request('/settings/keamanan', 'PUT', { session_timeout: 0, password: 'PRIVATE_PASSWORD' })).status, 422);
  assert.equal((await logs())[0].action, 'Gagal Edit');
  assert.equal((await request('/auth/login', 'POST', { username: 'operator', password: 'PRIVATE_PASSWORD' }, { 'Content-Type': 'application/json', connection: 'close', 'X-User-Id': '1' })).status, 401);
  assert.equal((await logs())[0].action, 'Gagal Login');
  assert.equal((await logs())[0].user_id, null);
  assert.equal((await request('/barang?search=audit-check&limit=5')).status, 200);
  assert.equal((await logs())[0].action, 'Cari');
  assert.match((await logs())[0].detail, /search=audit-check/);
  assert.doesNotMatch(JSON.stringify(await logs()), /PRIVATE_PASSWORD|Bearer/);
});

test('navigation, local preferences, print requests, and access denials use the authenticated actor', async () => {
  for (const event of [
    { type: 'navigation', path: '/pengaturan', tab: 'notifikasi' },
    { type: 'preference', path: '/', before: { tema: 'light' }, after: { tema: 'dark' } },
    { type: 'print', path: '/cetak-barcode', rack_ids: [1, 2] },
    { type: 'access_denied', path: '/master-barang', permission: 'barang.delete' },
    { type: 'search', path: '/master-barang', search: 'Oreo' },
    { type: 'pagination', path: '/master-barang', page: 2, limit: 5 },
  ]) {
    const count = (await logs()).length;
    assert.equal((await request('/log-activity/events', 'POST', { ...event, userId: 999, password: 'IGNORED_SECRET' })).status, 201);
    assert.equal((await logs()).length, count + 1);
    assert.equal((await logs())[0].user_id, 1);
  }
  assert.equal((await request('/log-activity/events', 'POST', { type: 'navigation', path: '/' }, { 'Content-Type': 'application/json', 'X-User-Id': '1', connection: 'close' })).status, 401);
  assert.equal((await logs())[0].user_id, null);
  assert.doesNotMatch(JSON.stringify(await logs()), /IGNORED_SECRET/);
});

test('reading the audit trail does not create an endless audit loop; manual backup is audited', async () => {
  const count = (await logs()).length;
  assert.equal((await request('/log-activity')).status, 200);
  assert.equal((await logs()).length, count);
  assert.equal((await request('/settings/backup', 'POST', {})).status, 200);
  assert.equal((await logs())[0].action, 'Backup');
});

test('only allowed settings fields can appear in a diff', () => {
  assert.equal(settingsChanges({ password: 'old', token: 'old' }, { password: 'new', token: 'new' }, ['password', 'token']), 'Disimpan tanpa perubahan nilai');
});

test('existing business logs are not duplicated by the fallback audit', async () => {
  const count = (await logs()).length;
  const created = await request('/kelompok-barang', 'POST', { kode: 'AUDIT-GRP', nama: 'Audit group' });
  assert.equal(created.status, 201);
  assert.equal((await logs()).length, count + 1);
  assert.equal((await logs())[0].action, 'Tambah');
  assert.match((await logs())[0].detail, /Audit group/);
  assert.equal((await request(`/kelompok-barang/${created.body.id}`, 'DELETE')).status, 200);
  assert.equal((await logs()).length, count + 2);
});

test('invalid JSON is audited without storing its raw contents', async () => {
  const response = await fetch(base + '/settings/tampilan', { method: 'PUT', headers, body: '{"password":"MALFORMED_SECRET"' });
  assert.equal(response.status, 400);
  assert.equal((await logs())[0].action, 'Gagal Edit');
  assert.doesNotMatch(JSON.stringify(await logs()), /MALFORMED_SECRET/);
});

test('activity API returns and searches the English log column contract', async () => {
  const { logActivity } = await import('../src/services/activityLogger.js');
  await logActivity({userId:1,action:'Column Contract',module:'English Log Schema',detail:'Column migration record'});
  for (const search of ['Column Contract','English Log Schema','Column migration record']) {
    const result=await request('/log-activity?search='+encodeURIComponent(search));
    assert.equal(result.status,200);
    const row=result.body.data.find(row=>row.action==='Column Contract');
    assert.ok(row);assert.equal(row.module,'English Log Schema');
    assert.equal(typeof row.occurred_at,'string');
    for(const old of ['aksi','modul','waktu']) assert.ok(!Object.hasOwn(row,old));
  }
});
