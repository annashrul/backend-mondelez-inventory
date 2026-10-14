import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dashboardRealtime } from '../src/middleware/dashboardRealtime.js';

function request(path, method = 'POST', status = 200, event = 'finish') {
  const signals = [];
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  let nextCalls = 0;
  dashboardRealtime({ emit: (...args) => signals.push(args) })({ originalUrl: path, method }, res, () => nextCalls++);
  assert.equal(signals.length, 0, 'nothing is broadcast before persistence and response finish');
  res.emit(event);
  res.emit(event);
  assert.equal(nextCalls, 1);
  return signals;
}

test('successful stock, product, master and user writes send a single payload-free refresh', () => {
  for (const [path, method] of [['/api/v1/barang', 'POST'], ['/api/v1/barang/1','PUT'], ['/api/v1/barang/1','DELETE'], ['/api/v1/pengambilan/execute','POST'], ['/api/v1/adjustment','POST'], ['/api/v1/kelompok-barang/1','PATCH'], ['/api/v1/satuan/1','PUT'], ['/api/v1/rak','POST'], ['/api/v1/pengguna/1','PUT']]) {
    assert.deepEqual(request(path,method,201), [['dashboard:updated']]);
  }
});

test('reads, failed or aborted requests and unrelated actions never broadcast refreshes', () => {
  for (const args of [['/api/v1/barang','GET'], ['/api/v1/barang','POST',422], ['/api/v1/pengambilan/execute','POST',500], ['/api/v1/barang','POST',200,'close'], ['/api/v1/rak/scan','POST'], ['/api/v1/rak/items','POST'], ['/api/v1/auth/session','POST'], ['/api/v1/notifications/read-all','POST'], ['/api/v1/settings/backup','POST']]) assert.deepEqual(request(...args), []);
});
