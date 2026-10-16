import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tableRenames, normalizeStoreTables } from '../src/config/tableNames.js';
process.env.NODE_ENV = 'test';

test('legacy store names normalize without dropping records or changing API fields', () => {
  const row = {id:7,rak_id:2,barang_id:1,nama:'Barang'};
  for (const [legacy,canonical] of Object.entries(tableRenames)) {
    const input = {[legacy]:[row],metadata:{pengambilan_barang:'notification'}};
    const result = normalizeStoreTables(input);
    assert.deepEqual(result[canonical],[row]);
    assert.ok(!Object.hasOwn(result,legacy));
    assert.deepEqual(result.metadata,input.metadata);
    assert.ok(Object.hasOwn(input,legacy),'input is not mutated');
  }
});
test('canonical stores and repeat normalization are stable; conflicting stores fail loudly', () => {
  const input = {items:[{id:1}],units:[],users:[]};
  assert.deepEqual(normalizeStoreTables(normalizeStoreTables(input)),input);
  assert.throws(() => normalizeStoreTables({barang:[{id:1}],items:[{id:2}]}),/Conflicting store tables/);
  assert.deepEqual(normalizeStoreTables({pengambilan:[{id:1}],adjustment:[],pengguna:[]}),{withdrawals:[{id:1}],stock_adjustments:[],users:[]});
});
test('SQL migration covers the canonical table mapping and preserves table identity', async () => {
  const sql = await readFile(new URL('../migrations/002_english_table_names.sql',import.meta.url),'utf8');
  for (const [legacy,canonical] of Object.entries(tableRenames)) assert.ok(sql.includes(`('${legacy}', '${canonical}')`));
  assert.match(sql,/ALTER TABLE %I\.%I RENAME TO %I/);
  assert.match(sql,/DROP VIEW %I\.%I/);
  assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?VIEW/);
  assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE TABLE|DELETE FROM/);
});

test('production SQL and dynamic master configuration use canonical table names', async () => {
  const { masterConfigs } = await import('../src/repositories/masterRepository.js');
  const legacyNames = new Set(Object.keys(tableRenames));
  for (const config of Object.values(masterConfigs)) {
    assert.ok(!legacyNames.has(config.table));
    assert.ok(!config.count || !legacyNames.has(config.count[0]));
  }
  const files = [
    'repositories/barangRepository.js','repositories/masterRepository.js',
    'repositories/pengambilanRepository.js','repositories/stockRepository.js',
    'repositories/dashboardRepository.js','services/activityLogger.js',
  ];
  for (const file of files) {
    const source = await readFile(new URL('../src/' + file,import.meta.url),'utf8');
    for (const name of legacyNames) {
      const pattern = new RegExp('\\b(?:FROM|JOIN|UPDATE|INTO|REFERENCES)\\s+(?:public\\.)?' + name + '\\b');
      assert.doesNotMatch(source,pattern,file);
    }
  }
});
