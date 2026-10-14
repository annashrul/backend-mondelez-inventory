import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { apiLogConfig, createApiLogWriter, createApiLogger, formatPrettyApiLog } from '../src/middleware/apiLogger.js';

function request(url, method = 'GET', env = {}, write) {
  const entries = [];
  const headers = {};
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  res.setHeader = (key, value) => { headers[key] = value; };
  let nextCalls = 0;
  createApiLogger(write || (entry => entries.push(entry)), { env, output: { isTTY: false } })(
    { originalUrl: url, method, body: { password: 'secret', api_key: 'secret', database_url: 'secret' }, headers: { authorization: 'Bearer secret', cookie: 'secret', 'x-api-key': 'secret' } },
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


const sample = {
  timestamp: '2026-10-14T09:29:03.503Z', level: 'info', event: 'api_request',
  request_id: '12345678-1234-1234-1234-123456789abc', method: 'POST',
  path: '/api/v1/auth/login', status: 200, duration_ms: 1100.62, aborted: false,
};
const stripAnsi = line => line.replace(/\x1b\[[0-9;]*m/g, '');

function complete(res, status = 200) {
  res.statusCode = status;
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');
}

test('pretty output uses WIB, aligned columns, request ID, and one banner', () => {
  const lines = [];
  const writer = createApiLogWriter(apiLogConfig({ LOG_FORMAT: 'pretty', LOG_COLOR: 'never' }), line => lines.push(line));
  writer(sample);
  writer({ ...sample, method: 'GET', path: '/api/v1/notifications', status: 304, duration_ms: 619 });
  assert.equal(lines[0], 'MONDELEZ INVENTORY — API REQUESTS');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^16:29:03  POST {4}/);
  assert.equal(lines[1].indexOf('/api/v1/'), lines[2].indexOf('/api/v1/'));
  assert.equal(lines[1].indexOf('200'), lines[2].indexOf('304'));
  assert.equal(lines[1].indexOf('ms'), lines[2].indexOf('ms'));
  assert.ok(lines[1].endsWith(`id=${sample.request_id}`));
  assert.equal(lines[1].includes('\x1b'), false);
});

test('WIB crosses midnight correctly regardless of host timezone', () => {
  const line = formatPrettyApiLog({ ...sample, timestamp: '2026-10-14T17:00:01.000Z' });
  assert.ok(line.startsWith('00:00:01'));
});

test('JSON output preserves all existing fields and precision without banner or ANSI', () => {
  for (const env of [{}, { LOG_FORMAT: 'json', LOG_COLOR: 'always' }, { LOG_FORMAT: 'invalid' }]) {
    const lines = [];
    createApiLogWriter(apiLogConfig(env), line => lines.push(line))(sample);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), sample);
    assert.equal(lines[0].includes('\x1b'), false);
  }
});

test('method and status ANSI colors retain plain-text alignment', () => {
  for (const [method, code] of [['GET', 32], ['POST', 36], ['PUT', 33], ['PATCH', 33], ['DELETE', 31]]) {
    const entry = { ...sample, method };
    const line = formatPrettyApiLog(entry, true);
    assert.ok(line.includes(`\x1b[${code}m${method.padEnd(7)}\x1b[0m`));
    assert.equal(stripAnsi(line), formatPrettyApiLog(entry, false));
  }
  for (const [status, code] of [[200, 32], [304, 36], [401, 33], [503, 31]]) {
    assert.ok(formatPrettyApiLog({ ...sample, status }, true).includes(`\x1b[${code}m${status}\x1b[0m`));
  }
});

test('color auto requires an ANSI-capable terminal; always and never override', () => {
  for (const [env, output, expected] of [
    [{}, { isTTY: false }, false], [{}, { isTTY: true }, true],
    [{ TERM: 'dumb' }, { isTTY: true }, false],
    [{ NO_COLOR: '' }, { isTTY: true }, false],
    [{ LOG_COLOR: 'never' }, { isTTY: true }, false],
    [{ LOG_COLOR: 'always', NO_COLOR: '' }, { isTTY: false }, true],
  ]) {
    const config = apiLogConfig({ LOG_FORMAT: 'pretty', ...env }, output);
    assert.equal(config.color, expected);
    const lines = [];
    createApiLogWriter(config, line => lines.push(line))(sample);
    assert.equal(lines[1].includes('\x1b'), expected);
  }
});

test('successful OPTIONS are hidden by default, with request ID still available', () => {
  for (const status of [200, 204, 304]) {
    const { entries, headers, res } = request('/api/v1/barang', 'OPTIONS');
    complete(res, status);
    assert.equal(entries.length, 0);
    assert.match(headers['X-Request-Id'], /^[a-f0-9-]{36}$/);
  }
  const { entries, res } = request('/api/v1/barang', 'OPTIONS', { LOG_SHOW_OPTIONS: 'true' });
  complete(res, 204);
  assert.equal(entries.length, 1);
});

test('OPTIONS errors and aborted OPTIONS are recorded', () => {
  for (const status of [400, 403, 500]) {
    const { entries, res } = request('/api/v1/barang', 'OPTIONS');
    complete(res, status);
    assert.equal(entries[0].status, status);
  }
  const { entries, res } = request('/api/v1/barang', 'OPTIONS');
  res.emit('close');
  assert.equal(entries[0].aborted, true);
});

test('LOG_LEVEL filters by severity for both output formats', () => {
  for (const format of ['pretty', 'json']) {
    for (const [level, statuses] of [['info', [200, 304, 401, 500]], ['warn', [401, 500]], ['error', [500]]]) {
      for (const status of [200, 304, 401, 500]) {
        const { entries, res } = request('/api/v1/barang', 'GET', { LOG_FORMAT: format, LOG_LEVEL: level });
        complete(res, status);
        assert.equal(entries.length, statuses.includes(status) ? 1 : 0);
      }
    }
  }
});

test('pretty aborted entries retain the status and explicit aborted marker', () => {
  const entry = { ...sample, status: 499, level: 'warn', aborted: true };
  const line = formatPrettyApiLog(entry);
  assert.match(line, /499/);
  assert.ok(line.endsWith(`id=${sample.request_id} aborted=true`));
});

test('sensitive body, headers, and query parameters are excluded in both formats', () => {
  for (const format of ['pretty', 'json']) {
    const lines = [];
    const write = createApiLogWriter(apiLogConfig({ LOG_FORMAT: format, LOG_COLOR: 'never' }), line => lines.push(line));
    const { res } = request('/api/v1/auth/login?password=secret&token=secret&api_key=secret', 'POST', {}, write);
    complete(res);
    assert.equal(lines.join(' ').includes('secret'), false);
    assert.equal(lines.join(' ').includes('?'), false);
  }
});

test('terminal control characters in paths cannot forge log lines', () => {
  const { entries, res } = request('/api/v1/barang\x1b[31m\nFAKE');
  complete(res);
  assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(entries[0].path), false);
});

test('a failing writer cannot break the response or print its sensitive error', (t) => {
  const errors = [];
  t.mock.method(console, 'error', line => errors.push(line));
  const { res } = request('/api/v1/barang', 'GET', {}, () => { throw new Error('secret'); });
  assert.doesNotThrow(() => complete(res));
  assert.deepEqual(errors, ['Gagal mencatat log API']);
});

test('default middleware writer honors configuration and outputs actual JSON/pretty', (t) => {
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  for (const format of ['json', 'pretty']) {
    const middleware = createApiLogger(undefined, { env: { LOG_FORMAT: format, LOG_COLOR: 'never' } });
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.writableFinished = true;
    res.statusCode = 200;
    middleware({ originalUrl: '/api/v1/health', method: 'GET' }, res, () => {});
    res.emit('finish');
  }
  assert.equal(JSON.parse(lines[0]).path, '/api/v1/health');
  assert.equal(lines[1], 'MONDELEZ INVENTORY — API REQUESTS');
  assert.match(lines[2], /GET +\/api\/v1\/health/);
});
