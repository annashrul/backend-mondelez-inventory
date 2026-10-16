import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { activityLogColumnRenames } from '../src/config/activityLogColumns.js';
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client = new pg.Client({connectionString,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const check = process.argv.includes('--check');
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query('LOCK TABLE public.activity_logs IN ACCESS EXCLUSIVE MODE');
  const snapshot = async () => (await client.query("SELECT 'public.activity_logs'::regclass::oid AS oid, count(*)::text AS rows, md5(COALESCE(string_agg(md5(t::text),'' ORDER BY t.id),'')) AS checksum FROM public.activity_logs t")).rows[0];
  // Row composite order is preserved by RENAME COLUMN, so the data checksum is stable.
  const before = await snapshot();
  const attributes = (await client.query("SELECT attname,attnum FROM pg_attribute WHERE attrelid='public.activity_logs'::regclass AND attnum>0 AND NOT attisdropped")).rows;
  await client.query(await readFile(new URL('../migrations/003_english_activity_log_columns.sql',import.meta.url),'utf8'));
  const after = await snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Activity log data or table identity changed');
  for (const [legacy,canonical] of Object.entries(activityLogColumnRenames)) {
    const source = attributes.find(row => row.attname===legacy || row.attname===canonical);
    const column = (await client.query("SELECT attnum FROM pg_attribute WHERE attrelid='public.activity_logs'::regclass AND attname=$1 AND NOT attisdropped",[canonical])).rows[0];
    if (!source || !column || column.attnum!==source.attnum) throw new Error(`Column identity changed: ${canonical}`);
  }
  await client.query(check ? 'ROLLBACK' : 'COMMIT');
  console.log(JSON.stringify({mode:check?'validated_rollback':'columns_renamed',table:'activity_logs',rows:after.rows,data_preserved:true,renames:activityLogColumnRenames}));
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('Activity log migration failed:',error.code || error.message);
  process.exitCode=1;
} finally {await client.end();}
