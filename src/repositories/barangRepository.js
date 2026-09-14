import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';

const fields = 'id, kode, barcode, nama, kelompok, satuan, rak, stok, stok_min, harga, deskripsi, image_path, image_url, embedding_model, (embedding IS NOT NULL) AS has_embedding, created_at, updated_at';
const useTestStore = process.env.NODE_ENV === 'test';

export async function findAll(search = '') {
  const term = search.trim();
  if (useTestStore) {
    const items = (await readStore()).barang;
    return term ? items.filter((item) => [item.kode, item.barcode, item.nama].some((value) => value?.toLowerCase().includes(term.toLowerCase()))) : items;
  }
  const result = await query(
    `SELECT ${fields} FROM barang
     WHERE $1 = '' OR kode ILIKE '%' || $1 || '%' OR barcode ILIKE '%' || $1 || '%' OR nama ILIKE '%' || $1 || '%'
     ORDER BY id`,
    [term]
  );
  return result.rows;
}

export async function findById(id) {
  if (useTestStore) return (await readStore()).barang.find((item) => item.id === id) || null;
  const result = await query(`SELECT ${fields} FROM barang WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function create(item, image = {}) {
  if (useTestStore) return updateStore((data) => {
    if (data.barang.some((row) => row.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'barang_kode_key' });
    if (data.barang.some((row) => row.barcode?.toLowerCase() === item.barcode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'barang_barcode_unique_idx' });
    const created = { id: Math.max(0, ...data.barang.map((row) => row.id)) + 1, ...item, image_path: image.path, image_url: image.url, embedding_model: image.model, has_embedding: Boolean(image.embedding) };
    data.barang.push(created);
    return created;
  });
  const values = ['kode', 'barcode', 'nama', 'kelompok', 'satuan', 'rak', 'stok', 'stok_min', 'harga'].map((field) => item[field]);
  const result = await query(
    `INSERT INTO barang (kode, barcode, nama, kelompok, satuan, rak, stok, stok_min, harga, image_path, image_url, embedding, embedding_model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::extensions.vector,$13) RETURNING ${fields}`,
    [...values, image.path || null, image.url || null, image.embedding ? JSON.stringify(image.embedding) : null, image.model || null]
  );
  return result.rows[0];
}

export async function update(id, item, image) {
  if (useTestStore) return updateStore((data) => {
    const index = data.barang.findIndex((row) => row.id === id);
    if (data.barang.some((row) => row.id !== id && row.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'barang_kode_key' });
    if (data.barang.some((row) => row.id !== id && row.barcode?.toLowerCase() === item.barcode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'barang_barcode_unique_idx' });
    data.barang[index] = { ...data.barang[index], ...item, ...(image ? { image_path: image.path, image_url: image.url, embedding_model: image.model, has_embedding: true } : {}) };
    return data.barang[index];
  });
  const values = ['kode', 'barcode', 'nama', 'kelompok', 'satuan', 'rak', 'stok', 'stok_min', 'harga'].map((field) => item[field]);
  const result = image
    ? await query(`UPDATE barang SET kode=$1, barcode=$2, nama=$3, kelompok=$4, satuan=$5, rak=$6, stok=$7, stok_min=$8, harga=$9,
        image_path=$10, image_url=$11, embedding=$12::extensions.vector, embedding_model=$13 WHERE id=$14 RETURNING ${fields}`,
      [...values, image.path, image.url, JSON.stringify(image.embedding), image.model, id])
    : await query(`UPDATE barang SET kode=$1, barcode=$2, nama=$3, kelompok=$4, satuan=$5, rak=$6, stok=$7, stok_min=$8, harga=$9
        WHERE id=$10 RETURNING ${fields}`, [...values, id]);
  return result.rows[0] || null;
}

export async function remove(id) {
  if (useTestStore) return updateStore((data) => {
    const index = data.barang.findIndex((row) => row.id === id);
    if (index < 0) return false;
    data.barang.splice(index, 1);
    return true;
  });
  const result = await query('DELETE FROM barang WHERE id = $1 RETURNING id', [id]);
  return Boolean(result.rowCount);
}

export async function findLookup(table) {
  if (!['kelompok_barang', 'satuan', 'rak'].includes(table)) throw new Error('Lookup tidak valid');
  if (useTestStore) return (await readStore())[table];
  return (await query(`SELECT * FROM ${table} ORDER BY id`)).rows;
}