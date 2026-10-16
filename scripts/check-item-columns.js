import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID}from'node:crypto';
import {readFile}from'node:fs/promises';
import pg from'pg';
import{itemColumnRenames}from'../src/config/itemColumns.js';
const connectionString=process.env.DIRECT_URL||process.env.DATABASE_URL;
if(!connectionString)throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client=new pg.Client({connectionString,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const schema='item_columns_test_'+randomUUID().replaceAll('-','');
const sql=await readFile(new URL('../migrations/004_english_item_columns.sql',import.meta.url),'utf8');
try{
 await client.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
 await client.query(`CREATE SCHEMA ${schema}`);await client.query("SELECT set_config('inventory.migration_schema',$1,true)",[schema]);
 await client.query(`CREATE TABLE ${schema}.item_groups(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,kode text UNIQUE,nama text NOT NULL,deskripsi text)`);
 await client.query(`CREATE TABLE ${schema}.items(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,kode text UNIQUE,nama text NOT NULL,kelompok_id bigint REFERENCES ${schema}.item_groups(id),satuan_id bigint,rak_id bigint,stok integer NOT NULL DEFAULT 0 CHECK(stok>=0),stok_min integer DEFAULT 0,harga numeric,deskripsi text,embedding text)`);
 await client.query(`CREATE TABLE ${schema}.withdrawals(id bigint PRIMARY KEY,barang_id bigint REFERENCES ${schema}.items(id))`);
 await client.query(`CREATE INDEX item_name_idx ON ${schema}.items(nama)`);
 await client.query(`ALTER TABLE ${schema}.items ENABLE ROW LEVEL SECURITY`);
 await client.query(`INSERT INTO ${schema}.item_groups(kode,nama,deskripsi)VALUES('G-1','Chain group','Original group')`);
 await client.query(`INSERT INTO ${schema}.items(kode,nama,kelompok_id,satuan_id,rak_id,stok,stok_min,harga,deskripsi,embedding)VALUES('I-1','Modular Chain',1,2,3,10,2,125.75,'Original item','[0.1,0.2]')`);
 await client.query(`INSERT INTO ${schema}.withdrawals VALUES(1,1)`);
 const snapshot=async table=>(await client.query(`SELECT '"${schema}".${table}'::regclass::oid AS oid,string_agg(t::text,'' ORDER BY id)AS values FROM ${schema}.${table} t`)).rows[0];
 const before={};for(const table of Object.keys(itemColumnRenames))before[table]=await snapshot(table);
 await client.query(sql);await client.query(sql);
 for(const[table,mapping]of Object.entries(itemColumnRenames)){
  assert.deepEqual(await snapshot(table),before[table]);
  const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows.map(row=>row.column_name);
  for(const[legacy,canonical]of Object.entries(mapping)){assert.ok(!columns.includes(legacy));assert.ok(columns.includes(canonical));}
 }
 const row=(await client.query(`SELECT i.*,g.name AS group_name FROM ${schema}.items i JOIN ${schema}.item_groups g ON g.id=i.item_group_id JOIN ${schema}.withdrawals w ON w.barang_id=i.id`)).rows[0];
 assert.equal(row.name,'Modular Chain');assert.equal(row.group_name,'Chain group');assert.equal(row.stock,10);assert.equal(row.price,'125.75');assert.equal(row.embedding,'[0.1,0.2]');
 const fresh=(await client.query(`INSERT INTO ${schema}.items(code,name,item_group_id)VALUES('I-2','New item',1)RETURNING stock`)).rows[0];assert.equal(fresh.stock,0);
 const index=(await client.query('SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',[schema,'item_name_idx'])).rows[0];assert.match(index.indexdef,/\(name\)/);
 assert.equal((await client.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1',[before.items.oid])).rows[0].relrowsecurity,true);
 await client.query('SAVEPOINT conflict');await client.query(`ALTER TABLE ${schema}.items ADD COLUMN kode text`);await assert.rejects(client.query(sql),error=>error.code==='P0001');await client.query('ROLLBACK TO SAVEPOINT conflict');
 await client.query('ROLLBACK');console.log('Item column checks passed: row values, embedding, defaults, FK, indexes, RLS, identity, idempotence and conflict rollback. No test data persisted.');
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Item column check failed:',error.code||'CHECK_ERROR',error.message);process.exitCode=1;}finally{await client.end();}
