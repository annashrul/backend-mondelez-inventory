import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(tmpdir(), 'notification-email-'));
process.env.DATA_FILE = path.join(directory, 'inventory.json');
const { getNotificationSetting, saveNotificationSetting, createPengambilanNotification, setNotificationSocket } = await import('../src/services/notificationService.js');
const { readStore } = await import('../src/config/store.js');
await writeFile(process.env.DATA_FILE, JSON.stringify({
  levels: [{ id: 1, nama: 'Admin' }],
  users: [
    { id: 1, level_id: 1, status: 'Aktif', email: 'admin@example.test' },
    { id: 2, level_id: 2, status: 'Aktif', email: 'staff@example.test' },
    { id: 3, level_id: 1, status: 'Nonaktif', email: 'inactive@example.test' },
    { id: 4, level_id: 2, status: 'Aktif', email: 'unselected@example.test' },
  ],
}));
after(() => rm(directory, { recursive: true, force: true }));
const payload = { transaction: { id: 10, no_ref: 'PIN-10', qty: 1, pemohon: 'Budi', barang_detail: { nama: 'Laptop' } }, stokAkhir: 9, createdBy: 1 };

test('email toggle persists and old clients preserve the setting', async () => {
  assert.equal((await getNotificationSetting()).email_enabled, false);
  await saveNotificationSetting({ level_ids: [1], user_ids: [2], email_enabled: true });
  assert.equal((await getNotificationSetting()).email_enabled, true);
  await saveNotificationSetting({ level_ids: [1], user_ids: [2] });
  assert.equal((await getNotificationSetting()).email_enabled, true);
  await assert.rejects(saveNotificationSetting({ email_enabled: 'false' }), error => error.status === 422);
});

test('enabled email uses selected active recipients and keeps realtime notifications', async (t) => {
  t.mock.method(console, 'log', () => {});
  const emails = [];
  const emitted = [];
  setNotificationSocket({ to: room => ({ emit: (event, item) => emitted.push({ room, event, item }) }) });
  const notification = await createPengambilanNotification(payload, { sendEmail: async (...args) => { emails.push(args); return { sent: 2 }; } });
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0][0].map(user => user.id), [1, 2]);
  assert.equal(emails[0][1].no_ref, 'PIN-10');
  assert.equal(emails[0][2], 9);
  assert.deepEqual(emitted.map(item => item.room), ['user:1', 'user:2']);
  assert.ok(notification.id);
});

test('disabled email never calls sender, while in-app notification is still created', async () => {
  await saveNotificationSetting({ level_ids: [1], user_ids: [2], email_enabled: false });
  let calls = 0;
  const notification = await createPengambilanNotification(payload, { sendEmail: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.ok(notification.id);
});

test('SMTP errors do not fail completed transactions and sensitive errors are not logged', async (t) => {
  await saveNotificationSetting({ level_ids: [1], user_ids: [], email_enabled: true });
  const logs = [];
  t.mock.method(console, 'error', message => logs.push(message));
  const notification = await createPengambilanNotification(payload, { sendEmail: async () => { throw Object.assign(new Error('SMTP_PASSWORD=secret'), { code: 'EAUTH' }); } });
  assert.ok(notification.id);
  assert.equal((await readStore()).notifications.length, 3);
  assert.equal(JSON.parse(logs[0]).code, 'EAUTH');
  assert.equal(logs[0].includes('secret'), false);
});

test('no selected recipients does not send email', async () => {
  await saveNotificationSetting({ level_ids: [], user_ids: [], email_enabled: true });
  const notification = await createPengambilanNotification(payload, { sendEmail: async () => { throw new Error('Should not send'); } });
  assert.equal(notification, null);
});
