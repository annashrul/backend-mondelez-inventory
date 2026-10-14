import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { notificationPagination } from '../src/utils/notificationPagination.js';

process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(tmpdir(), 'notification-pages-'));
process.env.DATA_FILE = path.join(directory, 'inventory.json');
const { listNotifications, markNotificationsRead } = await import('../src/services/notificationService.js');
const notifications = Array.from({ length: 55 }, (_, i) => ({ id: i + 1, title: `Notification ${i + 1}`, created_at: '2026-10-14T09:00:00.000Z' }));
const store = {
  notifications,
  notification_recipients: [
    ...notifications.map(item => ({ notification_id: item.id, user_id: 1, read_at: null })),
    { notification_id: 55, user_id: 2, read_at: '2026-10-14T10:00:00.000Z' },
  ],
};
await writeFile(process.env.DATA_FILE, JSON.stringify(store));
after(() => rm(directory, { recursive: true, force: true }));
const request = (query = {}, user = '1') => ({ headers: { 'x-user-id': user }, query });

test('validates bounded limits and bigint cursors', () => {
  assert.deepEqual(notificationPagination(), { limit: 10, cursor: null });
  assert.equal(notificationPagination({ limit: 1000 }).limit, 100);
  assert.equal(notificationPagination({ cursor: '9007199254740993' }).cursor, '9007199254740993');
  for (const limit of ['abc', 0, -1, 1.5, Infinity]) {
    assert.throws(() => notificationPagination({ limit }), error => error.status === 422);
  }
  for (const cursor of ['', '0', '-1', 'abc', '1 OR 1=1', '9223372036854775808', ['1', '2']]) {
    assert.throws(() => notificationPagination({ cursor }), error => error.status === 422);
  }
});

test('cursor pagination reaches every row once with a global unread count', async () => {
  const ids = [];
  let cursor;
  do {
    const response = await listNotifications(request(cursor ? { cursor } : {}));
    assert.equal(response.unread, 55);
    assert.ok(response.rows.length <= 10);
    ids.push(...response.rows.map(item => item.id));
    cursor = response.pagination.next_cursor;
    assert.equal(response.pagination.has_next, Boolean(cursor));
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: 55 }, (_, i) => 55 - i));
});

test('new notifications between pages do not shift the cursor or skip older rows', async () => {
  const first = await listNotifications(request({ limit: 10 }));
  store.notifications.push({ id: 56, title: 'New arrival', created_at: '2026-10-14T11:00:00.000Z' });
  store.notification_recipients.push({ notification_id: 56, user_id: 1, read_at: null });
  await writeFile(process.env.DATA_FILE, JSON.stringify(store));
  const second = await listNotifications(request({ limit: 10, cursor: first.pagination.next_cursor }));
  assert.deepEqual(second.rows.map(item => item.id), [45, 44, 43, 42, 41, 40, 39, 38, 37, 36]);
  assert.equal(second.unread, 56);
});

test('recipient scope, empty pages, and global mark-all-read remain correct', async () => {
  const other = await listNotifications(request({}, '2'));
  assert.deepEqual(other.rows.map(item => item.id), [55]);
  assert.equal(other.unread, 0);
  const empty = await listNotifications(request({ cursor: '1' }));
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.pagination.next_cursor, null);
  assert.equal((await listNotifications(request({}, undefined))).rows.length, 10);
  assert.equal((await listNotifications({ headers: {}, query: {} })).rows.length, 0);
  assert.equal(await markNotificationsRead(request()), 56);
  const read = await listNotifications(request({ cursor: '20' }));
  assert.equal(read.unread, 0);
  assert.ok(read.rows.every(item => item.read_at));
});
