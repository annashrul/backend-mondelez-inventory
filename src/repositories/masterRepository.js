import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';

const useTestStore = process.env.NODE_ENV === 'test';

export const masterConfigs = {
  'kelompok-barang': { table: 'kelompok_barang', fields: ['kode', 'nama', 'deskripsi'], count: ['barang', 'kelompok_id', 'jumlah_barang'], prefix: 'KLP' },
  satuan: { table: 'satuan', fields: ['kode', 'nama', 'deskripsi'], count: ['barang', 'satuan_id', 'jumlah_barang'], prefix: 'STN' },
  lokasi: { table: 'lokasi', fields: ['kode', 'nama', 'alamat', 'deskripsi'], count: ['rak', 'lokasi_id', 'jumlah_rak'], prefix: 'LOK' },
  rak: { table: 'rak', fields: ['kode', 'qr_code', 'nama', 'lokasi_id', 'kapasitas', 'terisi'], count: ['barang', 'rak_id', 'jumlah_barang'], prefix: 'RAK' }
};

function configFor(key) {
  const config = masterConfigs[key];
  if (!config) throw new Error('Master data tidak valid');
  return config;
}

function withCountSql(config) {
  if (!config.count) return 'm.*';
  const [referenceTable, referenceField, alias] = config.count;
  return `m.*, (SELECT COUNT(*)::int FROM ${referenceTable} r WHERE r.${referenceField} = m.id AND COALESCE(r.is_deleted, FALSE)=FALSE) AS ${alias}`;
}

function addTestCount(key, item, store) {
  const config = configFor(key);
  if (!config.count) return item;
  const [referenceTable, referenceField, alias] = config.count;
  const result = { ...item, [alias]: (store[referenceTable] || []).filter((row) => row[referenceField] === item.id && !row.is_deleted).length };
  if (key === 'rak') result.lokasi_detail = store.lokasi.find((row) => row.id === item.lokasi_id && !row.is_deleted) || null;
  return result;
}

function selectSql(key, config) {
  if (key !== 'rak') return withCountSql(config);
  return `${withCountSql(config)}, json_build_object('id',l.id,'kode',l.kode,'nama',l.nama) AS lokasi_detail`;
}

function nextCodeFromRows(rows, prefix) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const max = rows.reduce((highest, row) => {
    const match = String(row.kode || '').match(pattern);
    return match ? Math.max(highest, Number(match[1]) || 0) : highest;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export async function generateCode(key) {
  const config = configFor(key);
  if (useTestStore) {
    const store = await readStore();
    return nextCodeFromRows(store[config.table] || [], config.prefix);
  }
  const result = await query(`SELECT kode FROM ${config.table} WHERE kode ILIKE $1`, [`${config.prefix}-%`]);
  return nextCodeFromRows(result.rows, config.prefix);
}

export async function findAll(key, search = '') {
  const config = configFor(key);
  const term = search.trim().toLowerCase();
  if (useTestStore) {
    const store = await readStore();
    return (store[config.table] || [])
      .filter((item) => !term || `${item.kode} ${item.nama}`.toLowerCase().includes(term))
      .map((item) => addTestCount(key, item, store));
  }
  return (await query(
    `SELECT ${selectSql(key, config)} FROM ${config.table} m
     ${key === 'rak' ? 'JOIN lokasi l ON l.id=m.lokasi_id AND COALESCE(l.is_deleted, FALSE)=FALSE' : ''}
     WHERE COALESCE(m.is_deleted, FALSE)=FALSE
       AND ($1 = '' OR m.kode ILIKE '%' || $1 || '%' OR m.nama ILIKE '%' || $1 || '%')
     ORDER BY m.id`, [search.trim()]
  )).rows;
}

export async function findById(key, id) {
  const config = configFor(key);
  if (useTestStore) {
    const store = await readStore();
    const item = (store[config.table] || []).find((row) => row.id === id && !row.is_deleted);
    return item ? addTestCount(key, item, store) : null;
  }
  return (await query(`SELECT ${selectSql(key, config)} FROM ${config.table} m ${key === 'rak' ? 'JOIN lokasi l ON l.id=m.lokasi_id AND COALESCE(l.is_deleted, FALSE)=FALSE' : ''} WHERE m.id=$1 AND COALESCE(m.is_deleted, FALSE)=FALSE`, [id])).rows[0] || null;
}

export async function create(key, item) {
  const config = configFor(key);
  if (useTestStore) return updateStore((store) => {
    store[config.table] ||= [];
    if (store[config.table].some((row) => !row.is_deleted && row.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
    if (key === 'rak' && !store.lokasi.some((row) => row.id === item.lokasi_id && !row.is_deleted)) throw Object.assign(new Error('lokasi missing'), { code: 'INVALID_REFERENCE' });
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
    const index = store[config.table].findIndex((row) => row.id === id && !row.is_deleted);
    if (index < 0) return null;
    if (store[config.table].some((row) => !row.is_deleted && row.id !== id && row.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
    if (key === 'rak' && !store.lokasi.some((row) => row.id === item.lokasi_id && !row.is_deleted)) throw Object.assign(new Error('lokasi missing'), { code: 'INVALID_REFERENCE' });
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

export async function remove(key, id, deletedBy = null) {
  const config = configFor(key);
  const existing = await findById(key, id);
  if (!existing) return { removed: false, used: false };
  const usage = config.count ? Number(existing[config.count[2]]) : 0;
  if (usage > 0) return { removed: false, used: true };
  if (useTestStore) return updateStore((store) => {
    store[config.table] ||= [];
    const index = store[config.table].findIndex((row) => row.id === id && !row.is_deleted);
    if (index < 0) return { removed: false, used: false };
    store[config.table][index] = { ...store[config.table][index], is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: deletedBy };
    return { removed: true, used: false };
  });
  const result = await query(`UPDATE ${config.table} SET is_deleted=TRUE, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND COALESCE(is_deleted, FALSE)=FALSE`, [id, deletedBy]);
  return { removed: Boolean(result.rowCount), used: false };
}
