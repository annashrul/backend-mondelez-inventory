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

test('CRUD barang terintegrasi dengan lookup master', async () => {
  for (const endpoint of ['/kelompok-barang', '/satuan', '/rak']) {
    const lookup = await request(endpoint);
    assert.equal(lookup.status, 200);
    assert.ok(lookup.body.length > 0);
  }

  const payload = {
    kode: 'TEST-CRUD-001', barcode: '9900000000001', nama: 'Barang Smoke Test',
    kelompok: 'IT Supply', satuan: 'Pcs', rak: 'Rak B-01', stok: 10, stok_min: 2, harga: 12500
  };
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
  const created = await request('/barang', options);
  assert.equal(created.status, 201);

  const found = await request('/barang?search=Smoke');
  assert.ok(found.body.some((item) => item.id === created.body.id));

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

test('upload gambar menghasilkan URL dan indikator embedding', async () => {
  const form = new FormData();
  Object.entries({
    kode: 'TEST-IMG-001', barcode: '9900000000099', nama: 'Barang Gambar Test',
    kelompok: 'IT Supply', satuan: 'Pcs', rak: 'Rak B-01', stok: 1, stok_min: 0, harga: 5000
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
    { endpoint: 'rak', payload: { kode: `RAK-${suffix}`, qr_code: `QR-${suffix}`, nama: `Rak ${suffix}`, lokasi: 'Gudang Utama - Lantai 1', kapasitas: 20 } }
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
  }
});