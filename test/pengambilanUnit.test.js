import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pengambilanEmailTemplate } from '../src/services/emailTemplates.js';
import { pengambilanEmail } from '../src/services/emailService.js';

// Exercise the production repository path; the JSON test store already hydrates units.
const source = readFileSync(new URL('../src/repositories/pengambilanRepository.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('export ', '')
  .replace("const useTestStore = process.env.NODE_ENV === 'test';", 'const useTestStore = false;');

test('production withdrawal responses include the database unit used by HTML and plain-text email', async () => {
  const history = { id: 10, no_ref: 'AMB-10', qty: 1, barang_detail: { nama: 'Oreo', satuan_detail: { id: 3, kode: 'ST-003', nama: 'pcs' } } };
  let reads = 0;
  const query = async sql => {
    assert.match(sql, /LEFT JOIN satuan s ON s.id=b.satuan_id/);
    assert.match(sql, /'satuan_detail',json_build_object\('id',s.id,'kode',s.kode,'nama',s.nama\)/);
    reads++;
    return { rows: [history] };
  };
  const client = {
    async query(sql) {
      if (sql.includes('FOR UPDATE OF b')) return { rowCount: 1, rows: [{ id: 1, rak_id: 2, qr_code: 'RAK:2', stok: 5, satuan_nama: 'pcs' }] };
      if (sql.includes('RETURNING id')) return { rows: [{ id: 10 }] };
      return { rows: [] };
    },
    release() {},
  };
  const repository = new Function('pool', 'query', source + '\nreturn { listPengambilan, executePengambilan };')({ connect: async () => client }, query);
  assert.equal((await repository.listPengambilan())[0].barang_detail.satuan_detail.nama, 'pcs');
  const result = await repository.executePengambilan({ barang_id: 1, rak_id: 2, qr_code: 'RAK:2', pemohon: 'Budi', qty: 1 }, 1, '127.0.0.1');
  assert.equal(reads, 2);
  assert.match(pengambilanEmailTemplate(result.transaction, result.stok_akhir).html, /Jumlah pengambilan<\/td><td[^>]*>1 pcs<\/td>/);
  assert.match(pengambilanEmail(result.transaction, result.stok_akhir).text, /Jumlah: 1 pcs/);
});
