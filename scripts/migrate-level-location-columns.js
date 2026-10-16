import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { masterColumnRenames } from '../src/config/masterColumns.js';
const connectionString=process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client=new pg.Client({connectionString,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const check=process.argv.includes('--check');
try {
  await client.connect(); await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  const before=[];
  for (const [table,mapping] of Object.entries(masterColumnRenames)) {
    await client.query(`LOCK TABLE public.${table} IN ACCESS EXCLUSIVE MODE`);
    const snapshot=(await client.query(`SELECT 'public.${table}'::regclass::oid AS oid,count(*)::text AS rows,md5(COALESCE(string_agg(md5(t::text),'' ORDER BY t.id),'')) AS checksum FROM public.${table} t`)).rows[0];
    const attributes=(await client.query('SELECT attname,attnum FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped',[`public.${table}`])).rows;
    before.push({table,mapping,snapshot,attributes});
  }
  await client.query(await readFile(new URL('../migrations/005_english_level_location_columns.sql',import.meta.url),'utf8'));
  for (const {table,mapping,snapshot,attributes} of before) {
    const after=(await client.query(`SELECT 'public.${table}'::regclass::oid AS oid,count(*)::text AS rows,md5(COALESCE(string_agg(md5(t::text),'' ORDER BY t.id),'')) AS checksum FROM public.${table} t`)).rows[0];
    if (JSON.stringify(snapshot)!==JSON.stringify(after)) throw new Error(`Data changed: ${table}`);
    const columns=(await client.query('SELECT attname,attnum FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped',[`public.${table}`])).rows;
    for (const [legacy,canonical] of Object.entries(mapping)) {
      const source=attributes.find(row=>row.attname===legacy || row.attname===canonical), target=columns.find(row=>row.attname===canonical);
      if (!source || !target || source.attnum!==target.attnum || columns.some(row=>row.attname===legacy)) throw new Error(`Column validation failed: ${table}.${canonical}`);
    }
  }
  await client.query(check?'ROLLBACK':'COMMIT');
  console.log(JSON.stringify({mode:check?'validated_rollback':'columns_renamed',tables:before.map(({table,snapshot})=>({table,rows:snapshot.rows,data_preserved:true}))}));
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('Level/location column migration failed:',error.code || error.message);process.exitCode=1;
} finally {await client.end();}
