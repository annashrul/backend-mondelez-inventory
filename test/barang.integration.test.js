import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = './data/inventory.test.json';

const { default: app } = await import('../src/server.js');
const { closeDatabase } = await import('../src/config/database.js');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closeDatabase();
});

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...options?.headers, connection: 'close' }
  });
  const body = await response.json();
  return { status: response.status, body };
}

function listData(body) {
  assert.ok(Array.isArray(body.data));
  assert.ok(body.pagination);
  return body.data;
}

test('CRUD barang terintegrasi dengan lookup master', async () => {
  for (const endpoint of ['/kelompok-barang', '/satuan', '/rak']) {
    const lookup = await request(endpoint);
    assert.equal(lookup.status, 200);
    assert.ok(listData(lookup.body).length > 0);
    assert.equal(typeof lookup.body.pagination.total, 'number');
  }

  const suffix = Date.now();
  const payload = {
    kode: `CRUD-${suffix}`, barcode: `91${suffix}`, nama: 'Barang Smoke Test',
    kelompok_id: 2, satuan_id: 1, rak_id: 3, stok: 10, stok_min: 2, harga: 12500
  };
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
  const created = await request('/barang', options);
  assert.equal(created.status, 201);
  assert.equal(created.body.kelompok_id, payload.kelompok_id);
  assert.equal(created.body.satuan_id, payload.satuan_id);
  assert.equal(created.body.rak_id, payload.rak_id);
  assert.equal(created.body.kelompok_detail.nama, 'IT Supply');

  const found = await request('/barang?search=Smoke');
  assert.ok(listData(found.body).some((item) => item.id === created.body.id));

  const updated = await request(`/barang/${created.body.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ harga: 15000 })
  });
  assert.equal(updated.body.harga, 15000);

  const duplicate = await request('/barang', options);
  assert.equal(duplicate.status, 409);

  const deleted = await request(`/barang/${created.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await request(`/barang/${created.body.id}`)).status, 404);
});

test('barang menolak foreign key master yang tidak valid dan payload nama lama', async () => {
  const suffix = Date.now();
  const invalid = await request('/barang', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kode: `BAD-${suffix}`, barcode: `88${suffix}`, nama: 'Invalid FK', kelompok_id: 999999, satuan_id: 1, rak_id: 3, stok: 1, stok_min: 0, harga: 1 })
  });
  assert.equal(invalid.status, 422);

  const legacy = await request('/barang', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kode: `LEG-${suffix}`, barcode: `77${suffix}`, nama: 'Legacy Payload', kelompok: 'IT Supply', satuan: 'Pcs', rak: 'Rak B-01', stok: 1, stok_min: 0, harga: 1 })
  });
  assert.equal(legacy.status, 422);

  const search = await request('/kelompok-barang?search=IT%20Supply');
  assert.equal(search.status, 200);
  const searchRows = listData(search.body);
  assert.ok(searchRows.length > 0);
  assert.ok(searchRows.every((item) => item.nama.toLowerCase().includes('it supply') || item.kode.toLowerCase().includes('it supply')));
});

test('barang yang sudah digunakan transaksi dihapus dengan flag soft delete', async () => {
  const suffix = Date.now();
  const created = await request('/barang', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kode: `REF-${suffix}`, barcode: `99${suffix}`, nama: 'Barang Referenced Test',
      kelompok_id: 2, satuan_id: 1, rak_id: 3, stok: 10, stok_min: 1, harga: 1000
    })
  });
  assert.equal(created.status, 201);

  const transaction = await request('/pengambilan/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      barang_id: created.body.id,
      rak_id: created.body.rak_id,
      qr_code: created.body.rak_detail.qr_code,
      pemohon: 'Integration Test',
      qty: 1,
      keterangan: 'Menguji proteksi hapus barang'
    })
  });
  assert.equal(transaction.status, 201);

  const deleted = await request(`/barang/${created.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await request(`/barang/${created.body.id}`)).status, 404);

  const found = await request('/barang?search=Referenced');
  assert.equal(listData(found.body).some((item) => item.id === created.body.id), false);
});

test('kelompok bisa dihapus setelah semua barang terkait diarsipkan', async () => {
  const suffix = Date.now();
  const group = await request('/kelompok-barang', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kode: `KGD-${suffix}`, nama: `Kelompok Delete ${suffix}`, deskripsi: 'Soft delete relation test' })
  });
  assert.equal(group.status, 201);

  const barang = await request('/barang', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kode: `BGD-${suffix}`, barcode: `97${suffix}`, nama: 'Barang Group Delete Test',
      kelompok_id: group.body.id, satuan_id: 1, rak_id: 3, stok: 5, stok_min: 1, harga: 1000
    })
  });
  assert.equal(barang.status, 201);

  assert.equal((await request(`/barang/${barang.body.id}`, { method: 'DELETE' })).status, 200);
  const deletedGroup = await request(`/kelompok-barang/${group.body.id}`, { method: 'DELETE' });
  assert.equal(deletedGroup.status, 200);
  assert.equal((await request(`/kelompok-barang/${group.body.id}`)).status, 404);
});

test('upload gambar menghasilkan URL dan indikator embedding', async () => {
  const suffix = Date.now();
  const form = new FormData();
  Object.entries({
    kode: `IMG-${suffix}`, barcode: `92${suffix}`, nama: 'Barang Gambar Test',
    kelompok_id: 2, satuan_id: 1, rak_id: 3, stok: 1, stok_min: 0, harga: 5000
  }).forEach(([key, value]) => form.append(key, String(value)));
  form.append('image', new Blob([Buffer.from('fake-image')], { type: 'image/jpeg' }), 'barang.jpg');

  const created = await request('/barang', { method: 'POST', body: form });
  assert.equal(created.status, 201);
  assert.equal(created.body.has_embedding, true);
  assert.match(created.body.image_url, /^https:\/\/example\.test\//);

  const updated = await request(`/barang/${created.body.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ harga: 7500 })
  });
  assert.equal(updated.body.has_embedding, true);
  assert.equal(updated.body.image_url, created.body.image_url);
  assert.equal((await request(`/barang/${created.body.id}`, { method: 'DELETE' })).status, 200);
});

test('CRUD kelompok, satuan, lokasi, dan rak', async () => {
  const suffix = Date.now();
  const masters = [
    { endpoint: 'kelompok-barang', payload: { kode: `KLP-${suffix}`, nama: `Kelompok ${suffix}`, deskripsi: 'Integration test' } },
    { endpoint: 'satuan', payload: { kode: `STN-${suffix}`, nama: `Satuan ${suffix}`, deskripsi: 'Integration test' } },
    { endpoint: 'lokasi', payload: { kode: `LOK-${suffix}`, nama: `Lokasi ${suffix}`, alamat: 'Gedung Test', deskripsi: 'Integration test' } },
    { endpoint: 'rak', payload: { kode: `RAK-${suffix}`, qr_code: `QR-${suffix}`, nama: `Rak ${suffix}`, lokasi_id: 1, kapasitas: 20 } }
  ];

  for (const master of masters) {
    const created = await request(`/${master.endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(master.payload)
    });
    assert.equal(created.status, 201, `${master.endpoint} gagal dibuat`);
    assert.equal(created.body.kode, master.payload.kode);

    const found = await request(`/${master.endpoint}/${created.body.id}`);
    assert.equal(found.status, 200);

    const updated = await request(`/${master.endpoint}/${created.body.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nama: `${master.payload.nama} Updated` })
    });
    assert.equal(updated.status, 200);
    assert.match(updated.body.nama, /Updated$/);

    const duplicate = await request(`/${master.endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(master.payload)
    });
    assert.equal(duplicate.status, 409);

    const deleted = await request(`/${master.endpoint}/${created.body.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal((await request(`/${master.endpoint}/${created.body.id}`)).status, 404);

    if (master.endpoint === 'satuan') {
      const logs = await request(`/log-activity?search=${encodeURIComponent(master.payload.nama)}`);
      assert.equal(logs.status, 200);
      assert.ok(listData(logs.body).some((row) => row.aksi === 'Hapus' && row.modul === 'Master Satuan'));
    }
  }
});

test('katalog menu menyediakan aksi dan permission key yang konsisten', async () => {
  const response = await request('/menus');
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 15);

  const pengguna = response.body.find((menu) => menu.key === 'pengguna');
  assert.deepEqual(pengguna.actions.map((action) => action.key), ['read', 'create', 'update', 'delete']);
  assert.deepEqual(pengguna.actions.map((action) => action.permission), [
    'pengguna.read', 'pengguna.create', 'pengguna.update', 'pengguna.delete'
  ]);

  const barcode = response.body.find((menu) => menu.key === 'barcode');
  assert.ok(barcode.actions.some((action) => action.permission === 'barcode.print'));
});

test('CRUD level menyimpan permission dan menolak action ID tidak valid', async () => {
  const menus = (await request('/menus')).body;
  const actionIds = [menus[0].actions[0].id, menus.find((m) => m.key === 'pengguna').actions[0].id];
  const created = await request('/level-pengguna', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kode: 'LVL-TEST', nama: 'Test Level', deskripsi: 'Integration test', action_ids: actionIds }) });
  assert.equal(created.status, 201); assert.deepEqual(created.body.action_ids.map(Number).sort((a,b)=>a-b), actionIds.sort((a,b)=>a-b)); assert.ok(created.body.permissions.includes('pengguna.read'));
  const updated = await request(`/level-pengguna/${created.body.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action_ids: [menus[0].actions[0].id] }) });
  assert.deepEqual(updated.body.permissions, ['dashboard.read']);
  const invalid = await request('/level-pengguna', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kode: 'BAD', nama: 'Invalid', action_ids: [999999] }) });
  assert.equal(invalid.status, 422);
  assert.equal((await request(`/level-pengguna/${created.body.id}`, { method: 'DELETE' })).status, 200);
});

test('CRUD pengguna meng-hash password, login, menolak duplikat, dan melindungi level terpakai', async () => {
  const actionId = (await request('/menus')).body[0].actions[0].id;
  const level = await request('/level-pengguna', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kode: 'LVL-USER', nama: 'User Test', action_ids: [actionId] }) });
  const payload = { username: 'integration.user', password: 'rahasia123', nama: 'Integration User', email: 'user@test.local', level_id: level.body.id, status: 'Aktif' };
  const created = await request('/pengguna', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(created.status, 201); assert.equal('password' in created.body, false); assert.deepEqual(created.body.permissions, ['dashboard.read']);
  const duplicate = await request('/pengguna', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); assert.equal(duplicate.status, 409);
  const login = await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: payload.username, password: payload.password }) });
  assert.equal(login.status, 200); assert.ok(login.body.token); assert.equal('password' in login.body.user, false);
  assert.equal((await request(`/level-pengguna/${level.body.id}`, { method: 'DELETE' })).status, 409);
  const updated = await request(`/pengguna/${created.body.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nama: 'Updated User' }) }); assert.equal(updated.status, 200); assert.equal(updated.body.nama, 'Updated User');
  assert.equal((await request(`/pengguna/${created.body.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/level-pengguna/${level.body.id}`, { method: 'DELETE' })).status, 200);
});
