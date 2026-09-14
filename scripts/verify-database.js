import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const tables = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  const embedding = await client.query("SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relname='barang' AND a.attname='embedding' AND NOT a.attisdropped");
  const counts = await client.query('SELECT (SELECT count(*)::int FROM barang) barang, (SELECT count(*)::int FROM kelompok_barang) kelompok, (SELECT count(*)::int FROM satuan) satuan, (SELECT count(*)::int FROM rak) rak');
  console.log(JSON.stringify({ public_tables: tables.rows[0].count, embedding: embedding.rows[0]?.type, ...counts.rows[0] }, null, 2));
} finally {
  await client.end();
}