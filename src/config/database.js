import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL Supabase wajib dikonfigurasi');
}

export const pool = connectionString
  ? new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } })
  : null;

export async function query(text, params) {
  if (!pool) throw new Error('Koneksi database tidak tersedia');
  return pool.query(text, params);
}

export async function closeDatabase() {
  await pool?.end();
}