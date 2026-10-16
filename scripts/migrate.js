import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL atau DATABASE_URL wajib dikonfigurasi');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql = await readFile(path.join(root, 'database/schema.sql'), 'utf8');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(sql);
  await client.query(await readFile(new URL('../migrations/001_search_audit.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/002_english_table_names.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/003_english_activity_log_columns.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/004_english_item_columns.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/005_english_level_location_columns.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/006_english_menu_columns.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Migrasi Supabase berhasil.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Migrasi gagal: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}