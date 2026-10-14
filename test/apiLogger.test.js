import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApiLogger } from '../src/middleware/apiLogger.js';

function request(url, method = 'GET') {
  const entries = [];
  const headers = {};
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  res.setHeader = (key, value) => { headers[key] = value; };
  let nextCalls = 0;
  createApiLogger(entry => entries.push(entry))(
    { originalUrl: url, method, body: { password: 'secret' }, headers: { authorization: 'Bearer secret' } },
    res,
    () => { nextCalls++; },
  );
  return { entries, headers, res, nextCalls };
}

test('logs completed API requests once, without credentials or query parameters', () => {
  const { entries, headers, res, nextCalls } = request('/api/v1/auth/login?token=secret', 'POST');
  assert.equal(nextCalls, 1);
  assert.equal(entries.length, 0);
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.method, 'POST');
  assert.equal(entry.path, '/api/v1/auth/login');
  assert.equal(entry.status, 200);
  assert.equal(entry.level, 'info');
  assert.equal(entry.aborted, false);
  assert.equal(entry.request_id, headers['X-Request-Id']);
  assert.ok(entry.duration_ms >= 0);
  assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
  assert.equal(JSON.stringify(entry).includes('secret'), false);
});

test('logs client and server errors with the appropriate severity', () => {
  for (const [status, level] of [[400, 'warn'], [401, 'warn'], [404, 'warn'], [500, 'error']]) {
    const { entries, res } = request('/api/v1/notifications');
    res.statusCode = status;
    res.writableFinished = true;
    res.emit('finish');
    assert.equal(entries[0].status, status);
    assert.equal(entries[0].level, level);
  }
});

test('records aborted requests once', () => {
  const { entries, res } = request('/api/v1/notifications');
  res.emit('close');
  res.emit('finish');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 499);
  assert.equal(entries[0].aborted, true);
});

test('ignores paths outside the API', () => {
  for (const path of ['/socket.io/', '/api/v10/notifications', '/']) {
    const { entries, headers, res, nextCalls } = request(path);
    res.emit('finish');
    assert.equal(nextCalls, 1);
    assert.equal(entries.length, 0);
    assert.deepEqual(headers, {});
  }
});
