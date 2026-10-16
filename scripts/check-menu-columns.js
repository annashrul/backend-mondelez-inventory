import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {menuColumnRenames} from '../src/config/menuColumns.js';
const client=new pg.Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const schema='menu_columns_test_'+randomUUID().replaceAll('-','');
const sql=await readFile(new URL('../migrations/006_english_menu_columns.sql',import.meta.url),'utf8');
try {
 await client.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
 await client.query(`CREATE SCHEMA ${schema}`);await client.query("SELECT set_config('inventory.migration_schema',$1,true)",[schema]);
 await client.query(`CREATE TABLE ${schema}.menus(id bigint PRIMARY KEY,key text UNIQUE,nama text NOT NULL,grup text,path text,urutan integer DEFAULT 0,aktif boolean DEFAULT true)`);
 await client.query(`CREATE TABLE ${schema}.menu_actions(id bigint PRIMARY KEY,menu_id bigint REFERENCES ${schema}.menus(id),key text,nama text NOT NULL,urutan integer DEFAULT 0,aktif boolean DEFAULT true,UNIQUE(menu_id,key))`);
 await client.query(`CREATE TABLE ${schema}.level_permissions(level_id bigint,menu_action_id bigint REFERENCES ${schema}.menu_actions(id),PRIMARY KEY(level_id,menu_action_id))`);
 await client.query(`CREATE INDEX menu_order_idx ON ${schema}.menus(urutan)`);
 await client.query(`ALTER TABLE ${schema}.menu_actions ENABLE ROW LEVEL SECURITY`);
 await client.query(`INSERT INTO ${schema}.menus VALUES(1,'barang','Master Barang','Master Data','/master-barang',2,true),(2,'hidden','Hidden','Other','/hidden',1,false)`);
 await client.query(`INSERT INTO ${schema}.menu_actions VALUES(101,1,'read','Lihat',2,true),(102,1,'delete','Hapus',1,false)`);
 await client.query(`INSERT INTO ${schema}.level_permissions VALUES(1,101),(1,102)`);
 const snapshot=async table=>(await client.query(`SELECT '"${schema}".${table}'::regclass::oid AS oid,string_agg(t::text,'' ORDER BY id) AS values FROM ${schema}.${table} t`)).rows[0];
 const before={};for(const table of Object.keys(menuColumnRenames))before[table]=await snapshot(table);
 await client.query(sql);await client.query(sql);
 for(const [table,mapping] of Object.entries(menuColumnRenames)){
  assert.deepEqual(await snapshot(table),before[table]);
  const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows.map(row=>row.column_name);
  for(const [legacy,canonical]of Object.entries(mapping)){assert.ok(!columns.includes(legacy));assert.ok(columns.includes(canonical));}
 }
 const rows=(await client.query(`SELECT m.name,m.group_name,a.name AS action_name,m.key||'.'||a.key AS permission FROM ${schema}.menus m JOIN ${schema}.menu_actions a ON a.menu_id=m.id AND a.is_active=true JOIN ${schema}.level_permissions lp ON lp.menu_action_id=a.id WHERE m.is_active=true ORDER BY m.sort_order,a.sort_order`)).rows;
 assert.deepEqual(rows,[{name:'Master Barang',group_name:'Master Data',action_name:'Lihat',permission:'barang.read'}]);
 assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.level_permissions`)).rows[0].count,2);
 assert.match((await client.query('SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',[schema,'menu_order_idx'])).rows[0].indexdef,/\(sort_order\)/);
 assert.equal((await client.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1',[before.menu_actions.oid])).rows[0].relrowsecurity,true);
 assert.equal((await client.query(`INSERT INTO ${schema}.menu_actions(id,menu_id,key,name) VALUES(103,1,'create','Tambah') RETURNING sort_order,is_active`)).rows[0].is_active,true);
 await client.query('SAVEPOINT conflict');await client.query(`ALTER TABLE ${schema}.menus ADD COLUMN nama text`);await assert.rejects(client.query(sql),error=>error.code==='P0001');await client.query('ROLLBACK TO SAVEPOINT conflict');
 await client.query('ROLLBACK');console.log('Menu checks passed: data, identity, permissions, FK, active filtering, ordering, defaults, indexes, RLS, idempotence and conflict rollback. No test data persisted.');
} catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Menu column check failed:',error.code||'CHECK_ERROR',error.message);process.exitCode=1;}finally{await client.end();}
