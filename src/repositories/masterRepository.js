import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';

const useTestStore = process.env.NODE_ENV === 'test';

export const masterConfigs = {
  'kelompok-barang': { table: 'kelompok_barang', fields: ['kode', 'nama', 'deskripsi'], count: ['barang', 'kelompok', 'jumlah_barang'] },
  satuan: { table: 'satuan', fields: ['kode', 'nama', 'deskripsi'], count: ['barang', 'satuan', 'jumlah_barang'] },
  lokasi: { table: 'lokasi', fields: ['kode', 'nama', 'alamat', 'deskripsi'], count: ['rak', 'lokasi', 'jumlah_rak'] },
  rak: { table: 'rak', fields: ['kode', 'qr_code', 'nama', 'lokasi', 'kapasitas', 'terisi'], count: ['barang', 'rak', 'jumlah_barang'] }
};

function configFor(key) {
  const config = masterConfigs[key];
  if (!config) throw new Error('Master data tidak valid');
  return config;
}

function withCountSql(config) {
  if (!config.count) return 'm.*';
  const [referenceTable, referenceField, alias] = config.count;
  return `m.*, (SELECT COUNT(*)::int FROM ${referenceTable} r WHERE r.${referenceField} = m.nama) AS ${alias}`;
}

function addTestCount(key, item, store) {
  const config = configFor(key);
  if (!config.count) return item;
  const [referenceTable, referenceField, alias] = config.count;
  return { ...item, [alias]: (store[referenceTable] || []).filter((row) => row[referenceField] === item.nama).length };
}

export async function findAll(key) {
  const config = configFor(key);
  if (useTestStore) {
    const store = await readStore();
    return (store[config.table] || []).map((item) => addTestCount(key, item, store));
  }
  return (await query(`SELECT ${withCountSql(config)} FROM ${config.table} m ORDER BY m.id`)).rows;
}

export async function findById(key, id) {
  const config = configFor(key);
  if (useTestStore) {
    const store = await readStore();
    const item = (store[config.table] || []).find((row) => row.id === id);
    return item ? addTestCount(key, item, store) : null;
  }
  return (await query(`SELECT ${withCountSql(config)} FROM ${config.table} m WHERE m.id=$1`, [id])).rows[0] || null;
}

export async function create(key, item) {
  const config = configFor(key);
  if (useTestStore) return updateStore((store) => {
    store[config.table] ||= [];
    if (store[config.table].some((row) => row.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
    const created = { id: Math.max(0, ...store[config.table].map((row) => row.id)) + 1, ...item };
    store[config.table].push(created);
    return addTestCount(key, created, store);
  });
  const placeholders = config.fields.map((_, index) => `$${index + 1}`).join(',');
  const result = await query(
    `INSERT INTO ${config.table} (${config.fields.join(',')}) VALUES (${placeholders}) RETURNING *`,
    config.fields.map((field) => item[field])
  );
  return findById(key, result.rows[0].id);
}

export async function update(key, id, item) {
  const config = configFor(key);
  if (useTestStore) return updateStore((store) => {
    store[config.table] ||= [];
    const index = store[config.table].findIndex((row) => row.id === id);
    if (index < 0) return null;
    if (store[config.table].some((row) => row.id !== id && row.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
    store[config.table][index] = { ...store[config.table][index], ...item };
    return addTestCount(key, store[config.table][index], store);
  });
  const assignments = config.fields.map((field, index) => `${field}=$${index + 1}`).join(',');
  const result = await query(
    `UPDATE ${config.table} SET ${assignments}, updated_at=NOW() WHERE id=$${config.fields.length + 1} RETURNING id`,
    [...config.fields.map((field) => item[field]), id]
  );
  return result.rowCount ? findById(key, id) : null;
}

export async function remove(key, id) {
  const config = configFor(key);
  const existing = await findById(key, id);
  if (!existing) return { removed: false, used: false };
  const usage = config.count ? Number(existing[config.count[2]]) : 0;
  if (usage > 0) return { removed: false, used: true };
  if (useTestStore) return updateStore((store) => {
    store[config.table] ||= [];
    store[config.table] = store[config.table].filter((row) => row.id !== id);
    return { removed: true, used: false };
  });
  const result = await query(`DELETE FROM ${config.table} WHERE id=$1`, [id]);
  return { removed: Boolean(result.rowCount), used: false };
}