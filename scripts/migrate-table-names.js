import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { tableRenames } from '../src/config/tableNames.js';
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
const quoted = value => '"' + value.replaceAll('"','""') + '"';
const cleanup = process.argv.includes('--remove-legacy-views');
const checkOnly = process.argv.includes('--check');
const marker = 'inventory:legacy-table-alias:v1';
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  const before = [];
  for (const [legacy,canonical] of Object.entries(tableRenames)) {
    const relation = (await client.query("SELECT oid,relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) AND relkind IN ('r','p')", [[legacy,canonical]])).rows;
    if (relation.length > 1) throw new Error(`Conflicting tables: ${legacy}, ${canonical}`);
    if (!relation.length) continue;
    const row = relation[0];
    await client.query(`LOCK TABLE public.${quoted(row.relname)} IN ACCESS EXCLUSIVE MODE`);
    const count = (await client.query(`SELECT count(*)::text AS count FROM public.${quoted(row.relname)}`)).rows[0].count;
    before.push({ legacy,canonical,oid:row.oid,count });
  }
  if (cleanup) {
    // Deliberately no CASCADE: dependent objects must be handled explicitly.
    for (const [legacy,canonical] of Object.entries(tableRenames)) {
      const relation = (await client.query("SELECT relkind,obj_description(oid,'pg_class') AS comment FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=$1", [legacy])).rows[0];
      if (!relation) continue;
      if (relation.relkind !== 'v' || relation.comment !== marker) throw new Error(`Not a managed compatibility view: ${legacy}`);
      if (!before.some(row => row.canonical === canonical)) throw new Error(`Canonical table missing: ${canonical}`);
      await client.query(`DROP VIEW public.${quoted(legacy)}`);
    }
  } else {
    await client.query(await readFile(new URL('../migrations/002_english_table_names.sql', import.meta.url),'utf8'));
  }
  for (const row of before) {
    const after = (await client.query("SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=$1 AND relkind IN ('r','p')",[row.canonical])).rows[0];
    if (!after || Number(after.oid) !== Number(row.oid)) throw new Error(`Table identity changed: ${row.canonical}`);
    const count = (await client.query(`SELECT count(*)::text AS count FROM public.${quoted(row.canonical)}`)).rows[0].count;
    if (count !== row.count) throw new Error(`Row count changed: ${row.canonical}`);
  }
  const legacyRelations = await client.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) AND relkind IN ('r','p','v','m')", [Object.keys(tableRenames)]);
  if (legacyRelations.rows.length) throw new Error('Legacy relations still exist');
  await client.query(checkOnly ? 'ROLLBACK' : 'COMMIT');
  console.log(JSON.stringify({ mode:checkOnly ? 'validated_rollback' : cleanup ? 'legacy_views_removed' : 'tables_renamed', tables:before.map(row => ({ name:row.canonical,rows:row.count,identity_preserved:true })) },null,2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Table migration failed:', error.code || error.message);
  process.exitCode=1;
} finally { await client.end(); }
