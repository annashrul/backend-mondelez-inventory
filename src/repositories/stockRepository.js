import { pool, query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';

const useTestStore = process.env.NODE_ENV === 'test';

const barangDetailSql = "json_build_object('id',b.id,'kode',b.code,'nama',b.name,'stok_min',b.min_stock) AS barang_detail";
const userDetailSql = "json_build_object('id',u.id,'username',u.username,'nama',u.nama) AS user_detail";

function hydrateTransaction(item, store) {
  return {
    ...item,
    barang_detail: store.items.find((row) => Number(row.id) === Number(item.barang_id)) || null,
    user_detail: (store.users || []).find((row) => Number(row.id) === Number(item.user_id)) || null,
  };
}

function nextAdjustmentRef() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ADJ-${date}-${random}`;
}

export async function listAdjustments({ search = '' } = {}) {
  const term = search.trim().toLowerCase();
  if (useTestStore) {
    const store = await readStore();
    return (store.stock_adjustments || [])
      .map((item) => hydrateTransaction(item, store))
      .filter((item) => !term || `${item.no_ref} ${item.alasan || ''} ${item.barang_detail?.nama || ''}`.toLowerCase().includes(term))
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || Number(b.id) - Number(a.id));
  }

  return (await query(
    `SELECT a.id, a.tanggal, a.no_ref, a.barang_id, a.tipe, a.qty, a.alasan, a.user_id, a.created_at,
      ${barangDetailSql}, ${userDetailSql}
     FROM stock_adjustments a
     LEFT JOIN items b ON b.id=a.barang_id
     LEFT JOIN users u ON u.id=a.user_id
     WHERE $1 = '' OR a.no_ref ILIKE '%' || $1 || '%' OR a.alasan ILIKE '%' || $1 || '%' OR b.name ILIKE '%' || $1 || '%'
     ORDER BY a.tanggal DESC, a.id DESC`,
    [search.trim()],
  )).rows;
}

export async function listKartuStok({ search = '', tipe = 'Semua' } = {}) {
  const term = search.trim().toLowerCase();
  const selectedType = ['Masuk', 'Keluar'].includes(tipe) ? tipe : '';
  if (useTestStore) {
    const store = await readStore();
    return (store.stock_movements || [])
      .map((item) => hydrateTransaction(item, store))
      .filter((item) => !selectedType || item.tipe === selectedType)
      .filter((item) => !term || `${item.no_ref} ${item.keterangan || ''} ${item.barang_detail?.nama || ''}`.toLowerCase().includes(term))
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || Number(b.id) - Number(a.id));
  }

  return (await query(
    `SELECT k.id, k.tanggal, k.tipe, k.no_ref, k.barang_id, k.qty, k.saldo, k.keterangan, k.user_id, k.created_at,
      ${barangDetailSql}, ${userDetailSql}
     FROM stock_movements k
     LEFT JOIN items b ON b.id=k.barang_id
     LEFT JOIN users u ON u.id=k.user_id
     WHERE ($1 = '' OR k.tipe=$1)
       AND ($2 = '' OR k.no_ref ILIKE '%' || $2 || '%' OR k.keterangan ILIKE '%' || $2 || '%' OR b.name ILIKE '%' || $2 || '%')
     ORDER BY k.tanggal DESC, k.id DESC`,
    [selectedType, search.trim()],
  )).rows;
}

export async function createAdjustment(payload, userId) {
  const noRef = nextAdjustmentRef();

  if (useTestStore) return updateStore((store) => {
    const barang = store.items.find((row) => Number(row.id) === Number(payload.barang_id) && !row.is_deleted);
    if (!barang) throw Object.assign(new Error('barang missing'), { code: 'BARANG_NOT_FOUND' });

    const qty = Number(payload.qty);
    if (payload.tipe === 'Kurang' && qty > Number(barang.stok)) {
      throw Object.assign(new Error('insufficient stock'), { code: 'INSUFFICIENT_STOCK', stock: barang.stok });
    }

    const saldo = payload.tipe === 'Tambah' ? Number(barang.stok) + qty : Number(barang.stok) - qty;
    barang.stok = saldo;
    store.stock_adjustments ||= [];
    store.stock_movements ||= [];
    const adjustment = {
      id: Math.max(0, ...store.stock_adjustments.map((row) => Number(row.id) || 0)) + 1,
      tanggal: payload.tanggal,
      no_ref: noRef,
      barang_id: barang.id,
      tipe: payload.tipe,
      qty,
      alasan: payload.alasan,
      user_id: userId,
    };
    const card = {
      id: Math.max(0, ...store.stock_movements.map((row) => Number(row.id) || 0)) + 1,
      tanggal: new Date().toISOString(),
      tipe: payload.tipe === 'Tambah' ? 'Masuk' : 'Keluar',
      no_ref: noRef,
      barang_id: barang.id,
      qty,
      saldo,
      keterangan: payload.alasan,
      user_id: userId,
    };
    store.stock_adjustments.unshift(adjustment);
    store.stock_movements.unshift(card);
    return { adjustment: hydrateTransaction(adjustment, store), saldo };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id, code AS kode, name AS nama, stock AS stok FROM items
       WHERE id=$1 AND COALESCE(is_deleted, FALSE)=FALSE
       FOR UPDATE`,
      [payload.barang_id],
    );
    if (!locked.rowCount) throw Object.assign(new Error('barang missing'), { code: 'BARANG_NOT_FOUND' });
    const barang = locked.rows[0];
    const qty = Number(payload.qty);
    if (payload.tipe === 'Kurang' && qty > Number(barang.stok)) {
      throw Object.assign(new Error('insufficient stock'), { code: 'INSUFFICIENT_STOCK', stock: barang.stok });
    }
    const saldo = payload.tipe === 'Tambah' ? Number(barang.stok) + qty : Number(barang.stok) - qty;
    await client.query('UPDATE items SET stock=$1, updated_at=NOW() WHERE id=$2', [saldo, payload.barang_id]);
    const adjustment = await client.query(
      `INSERT INTO stock_adjustments(tanggal,no_ref,barang_id,tipe,qty,alasan,user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [payload.tanggal, noRef, payload.barang_id, payload.tipe, qty, payload.alasan, userId],
    );
    await client.query(
      `INSERT INTO stock_movements(tipe,no_ref,barang_id,user_id,qty,saldo,keterangan)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [payload.tipe === 'Tambah' ? 'Masuk' : 'Keluar', noRef, payload.barang_id, userId, qty, saldo, payload.alasan],
    );
    await client.query('COMMIT');
    const row = (await query(
      `SELECT a.id, a.tanggal, a.no_ref, a.barang_id, a.tipe, a.qty, a.alasan, a.user_id, a.created_at,
        ${barangDetailSql}, ${userDetailSql}
       FROM stock_adjustments a
       LEFT JOIN items b ON b.id=a.barang_id
       LEFT JOIN users u ON u.id=a.user_id
       WHERE a.id=$1`,
      [adjustment.rows[0].id],
    )).rows[0];
    return { adjustment: row, saldo };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
