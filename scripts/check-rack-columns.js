import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {rackColumnRenames} from '../src/config/rackColumns.js';
const client=new pg.Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const schema='rack_columns_test_'+randomUUID().replaceAll('-','');
const sql=await readFile(new URL('../migrations/007_english_rack_columns.sql',import.meta.url),'utf8');
try {
 await client.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
 await client.query(`CREATE SCHEMA ${schema}`);await client.query("SELECT set_config('inventory.migration_schema',$1,true)",[schema]);
 await client.query(`CREATE TABLE ${schema}.locations(id bigint PRIMARY KEY,name text)`);
 await client.query(`CREATE TABLE ${schema}.racks(id bigint PRIMARY KEY,kode text UNIQUE,nama text NOT NULL,qr_code text UNIQUE,lokasi_id bigint REFERENCES ${schema}.locations(id),kapasitas integer NOT NULL DEFAULT 0 CHECK(kapasitas>=0),terisi integer NOT NULL DEFAULT 0)`);
 await client.query(`CREATE TABLE ${schema}.items(id bigint PRIMARY KEY,rack_id bigint REFERENCES ${schema}.racks(id))`);
 await client.query(`CREATE TABLE ${schema}.withdrawals(id bigint PRIMARY KEY,rak_id bigint REFERENCES ${schema}.racks(id))`);
 await client.query(`CREATE INDEX rack_location_idx ON ${schema}.racks(lokasi_id)`);
 await client.query(`ALTER TABLE ${schema}.racks ENABLE ROW LEVEL SECURITY`);
 await client.query(`INSERT INTO ${schema}.locations VALUES(1,'Warehouse')`);
 await client.query(`INSERT INTO ${schema}.racks VALUES(1,'RAK-1','Rack One','RAK:RAK-1',1,100,12)`);
 await client.query(`INSERT INTO ${schema}.items VALUES(1,1)`);await client.query(`INSERT INTO ${schema}.withdrawals VALUES(1,1)`);
 const snapshot=async()=>(await client.query(`SELECT '"${schema}".racks'::regclass::oid AS oid,string_agg(t::text,'' ORDER BY id) AS values FROM ${schema}.racks t`)).rows[0];
 const before=await snapshot();await client.query(sql);await client.query(sql);assert.deepEqual(await snapshot(),before);
 const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,'racks'])).rows.map(row=>row.column_name);
 for(const [legacy,canonical]of Object.entries(rackColumnRenames.racks)){assert.ok(!columns.includes(legacy));assert.ok(columns.includes(canonical));}
 const row=(await client.query(`SELECT r.code,r.name,r.qr_code,r.capacity,r.occupied,l.name AS location FROM ${schema}.racks r JOIN ${schema}.locations l ON l.id=r.location_id JOIN ${schema}.items i ON i.rack_id=r.id JOIN ${schema}.withdrawals w ON w.rak_id=r.id WHERE r.qr_code=$1`,['RAK:RAK-1'])).rows[0];
 assert.deepEqual(row,{code:'RAK-1',name:'Rack One',qr_code:'RAK:RAK-1',capacity:100,occupied:12,location:'Warehouse'});
 assert.match((await client.query('SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',[schema,'rack_location_idx'])).rows[0].indexdef,/\(location_id\)/);
 assert.equal((await client.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1',[before.oid])).rows[0].relrowsecurity,true);
 assert.deepEqual((await client.query(`INSERT INTO ${schema}.racks(id,code,name,qr_code,location_id) VALUES(2,'RAK-2','Second','QR2',1) RETURNING capacity,occupied`)).rows[0],{capacity:0,occupied:0});
 await client.query('SAVEPOINT invalid');await assert.rejects(client.query(`UPDATE ${schema}.racks SET capacity=-1 WHERE id=1`),error=>error.code==='23514');await client.query('ROLLBACK TO SAVEPOINT invalid');
 await client.query('SAVEPOINT conflict');await client.query(`ALTER TABLE ${schema}.racks ADD COLUMN kode text`);await assert.rejects(client.query(sql),error=>error.code==='P0001');await client.query('ROLLBACK TO SAVEPOINT conflict');
 await client.query('ROLLBACK');console.log('Rack checks passed: row values, identity, QR, location/item/withdrawal FKs, defaults, constraints, index, RLS, idempotence and conflict rollback. No test data persisted.');
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Rack column check failed:',error.code||'CHECK_ERROR',error.message);process.exitCode=1;}finally{await client.end();}
