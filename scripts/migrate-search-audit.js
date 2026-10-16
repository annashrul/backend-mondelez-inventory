import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../migrations/001_search_audit.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Tabel search_audit siap.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migrasi audit gagal:', error.code || 'DATABASE_ERROR');
  process.exitCode = 1;
} finally { await client.end(); }
