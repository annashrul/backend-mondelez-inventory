// Exercise real PostgreSQL rename, foreign keys, removal of legacy aliases,
// idempotence and conflict handling in a temporary schema; always roll back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client = new pg.Client({ connectionString,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000 });
const schema = 'table_rename_test_' + randomUUID().replaceAll('-','');
const sql = await readFile(new URL('../migrations/002_english_table_names.sql',import.meta.url),'utf8');
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query("SELECT set_config('inventory.migration_schema',$1,true)",[schema]);
  await client.query(`CREATE TABLE ${schema}.rak (id bigint PRIMARY KEY)`);
  await client.query(`CREATE TABLE ${schema}.barang (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,rak_id bigint REFERENCES ${schema}.rak(id),stok integer NOT NULL CHECK (stok>=0))`);
  await client.query(`CREATE TABLE ${schema}.pengambilan_barang (id bigint PRIMARY KEY,barang_id bigint REFERENCES ${schema}.barang(id))`);
  await client.query(`INSERT INTO ${schema}.rak VALUES (1)`);
  await client.query(`INSERT INTO ${schema}.barang(rak_id,stok) VALUES (1,10)`);
  await client.query(`INSERT INTO ${schema}.pengambilan_barang VALUES (1,1)`);
  await client.query(`ALTER TABLE ${schema}.barang ENABLE ROW LEVEL SECURITY`);
  const before=(await client.query('SELECT to_regclass($1)::oid AS oid',[`${schema}.barang`])).rows[0].oid;
  await client.query(sql);
  await client.query(sql); // Repeat without recreating legacy relations.
  const after=(await client.query('SELECT to_regclass($1)::oid AS oid',[`${schema}.items`])).rows[0].oid;
  assert.equal(before,after);
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.withdrawals w JOIN ${schema}.items i ON i.id=w.barang_id JOIN ${schema}.racks r ON r.id=i.rak_id`)).rows[0].count,1);
  await client.query(`UPDATE ${schema}.items SET stok=11 WHERE id=1`);
  assert.equal((await client.query(`SELECT stok FROM ${schema}.items WHERE id=1`)).rows[0].stok,11);
  await client.query(`INSERT INTO ${schema}.items(rak_id,stok) VALUES (1,12) RETURNING id`);
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.items`)).rows[0].count,2);
  assert.equal((await client.query('SELECT to_regclass($1) AS relation',[`${schema}.barang`])).rows[0].relation,null);
  // Upgrade a database that still has managed compatibility views.
  await client.query(`CREATE VIEW ${schema}.barang AS SELECT * FROM ${schema}.items`);
  await client.query(`COMMENT ON VIEW ${schema}.barang IS 'inventory:legacy-table-alias:v1'`);
  await client.query(sql);
  assert.equal((await client.query('SELECT to_regclass($1) AS relation',[`${schema}.barang`])).rows[0].relation,null);
  // Refuse to delete an unrelated view that happens to use a legacy name.
  await client.query('SAVEPOINT unrelated');
  await client.query(`CREATE VIEW ${schema}.barang AS SELECT * FROM ${schema}.items`);
  await assert.rejects(client.query(sql),error => error.code === 'P0001');
  await client.query('ROLLBACK TO SAVEPOINT unrelated');
  assert.equal((await client.query('SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass($1)',[`${schema}.items`])).rows[0].relrowsecurity,true);
  await client.query('SAVEPOINT conflict');
  await client.query(`CREATE TABLE ${schema}.satuan(id int)`);
  await client.query(`CREATE TABLE ${schema}.units(id int)`);
  await assert.rejects(client.query(sql),error => error.code === 'P0001');
  await client.query('ROLLBACK TO SAVEPOINT conflict');
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.items`)).rows[0].count,2);
  await client.query('ROLLBACK');
  console.log('PostgreSQL migration checks passed: identity, rows, FK, legacy view removal, RLS, idempotence, conflict rollback. No test data persisted.');
} catch(error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration check failed:', error.code || 'CHECK_ERROR', error.message);
  process.exitCode=1;
} finally {await client.end();}
