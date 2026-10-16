import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {masterColumnRenames} from '../src/config/masterColumns.js';
const client=new pg.Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const schema='master_columns_test_'+randomUUID().replaceAll('-','');
const sql=await readFile(new URL('../migrations/005_english_level_location_columns.sql',import.meta.url),'utf8');
try {
 await client.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
 await client.query(`CREATE SCHEMA ${schema}`);await client.query("SELECT set_config('inventory.migration_schema',$1,true)",[schema]);
 await client.query(`CREATE TABLE ${schema}.levels(id bigint PRIMARY KEY,kode text UNIQUE,nama text NOT NULL,deskripsi text,hak_akses text)`);
 await client.query(`CREATE TABLE ${schema}.locations(id bigint PRIMARY KEY,kode text UNIQUE,nama text NOT NULL,alamat text,deskripsi text)`);
 await client.query(`CREATE TABLE ${schema}.users(id bigint PRIMARY KEY,level_id bigint REFERENCES ${schema}.levels(id))`);
 await client.query(`CREATE TABLE ${schema}.level_permissions(level_id bigint REFERENCES ${schema}.levels(id),menu_action_id bigint,PRIMARY KEY(level_id,menu_action_id))`);
 await client.query(`CREATE TABLE ${schema}.racks(id bigint PRIMARY KEY,lokasi_id bigint REFERENCES ${schema}.locations(id))`);
 await client.query(`CREATE INDEX location_name_idx ON ${schema}.locations(nama)`);
 await client.query(`ALTER TABLE ${schema}.locations ENABLE ROW LEVEL SECURITY`);
 await client.query(`INSERT INTO ${schema}.levels VALUES(1,'LVL-1','Admin','Original level','1 permission')`);
 await client.query(`INSERT INTO ${schema}.locations VALUES(1,'LOC-1','Warehouse','Original address','Original location')`);
 await client.query(`INSERT INTO ${schema}.users VALUES(1,1)`);await client.query(`INSERT INTO ${schema}.racks VALUES(1,1)`);await client.query(`INSERT INTO ${schema}.level_permissions VALUES(1,42)`);
 const snapshot=async table=>(await client.query(`SELECT '"${schema}".${table}'::regclass::oid AS oid,string_agg(t::text,'' ORDER BY id) AS values FROM ${schema}.${table} t`)).rows[0];
 const before={};for(const table of Object.keys(masterColumnRenames))before[table]=await snapshot(table);
 await client.query(sql);await client.query(sql);
 for(const [table,mapping] of Object.entries(masterColumnRenames)) {
  assert.deepEqual(await snapshot(table),before[table]);
  const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows.map(row=>row.column_name);
  for(const [legacy,canonical]of Object.entries(mapping)){assert.ok(!columns.includes(legacy));assert.ok(columns.includes(canonical));}
 }
 assert.equal((await client.query(`SELECT l.name,lp.menu_action_id FROM ${schema}.users u JOIN ${schema}.levels l ON l.id=u.level_id JOIN ${schema}.level_permissions lp ON lp.level_id=l.id`)).rows[0].menu_action_id,'42');
 assert.equal((await client.query(`SELECT l.address FROM ${schema}.racks r JOIN ${schema}.locations l ON l.id=r.lokasi_id`)).rows[0].address,'Original address');
 assert.match((await client.query('SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',[schema,'location_name_idx'])).rows[0].indexdef,/\(name\)/);
 assert.equal((await client.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1',[before.locations.oid])).rows[0].relrowsecurity,true);
 await client.query('SAVEPOINT conflict');await client.query(`ALTER TABLE ${schema}.levels ADD COLUMN kode text`);await assert.rejects(client.query(sql),error=>error.code==='P0001');await client.query('ROLLBACK TO SAVEPOINT conflict');
 await client.query('ROLLBACK');console.log('Level/location checks passed: values, identity, user permissions, rack FK, indexes, RLS, idempotence and conflict rollback. No test data persisted.');
} catch(error) {await client.query('ROLLBACK').catch(()=>{});console.error('Master column check failed:',error.code||'CHECK_ERROR',error.message);process.exitCode=1;} finally {await client.end();}
