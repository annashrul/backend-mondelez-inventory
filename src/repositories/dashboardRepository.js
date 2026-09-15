import { query } from '../config/database.js';
import { readStore } from '../config/store.js';

const useTestStore = process.env.NODE_ENV === 'test';

function hydrateBarang(item, store) {
  const satuan = (store.satuan || []).find((row) => Number(row.id) === Number(item.satuan_id));
  return {
    ...item,
    satuan_detail: satuan ? { id: satuan.id, kode: satuan.kode, nama: satuan.nama } : null,
  };
}

export async function getDashboardStats() {
  if (useTestStore) {
    const store = await readStore();
    const barang = (store.barang || []).filter((item) => !item.is_deleted);
    const today = new Date().toISOString().slice(0, 10);
    const kartuStok = [...(store.kartu_stok || [])].sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || Number(b.id) - Number(a.id));
    const users = store.users || store.pengguna || [];

    return {
      totalBarang: barang.length,
      totalTransaksi: kartuStok.filter((item) => String(item.tanggal || '').slice(0, 10) === today).length,
      stokMenipis: barang.filter((item) => Number(item.stok) <= Number(item.stok_min)).length,
      nilaiInventory: barang.reduce((total, item) => total + Number(item.stok || 0) * Number(item.harga || 0), 0),
      aktivitasTerbaru: kartuStok.slice(0, 5).map((item) => {
        const product = barang.find((row) => Number(row.id) === Number(item.barang_id));
        const user = users.find((row) => Number(row.id) === Number(item.user_id));
        return {
          id: item.id,
          tanggal: item.tanggal,
          tipe: item.tipe,
          no_ref: item.no_ref,
          barang: product?.nama || '-',
          qty: item.qty,
          keterangan: item.keterangan,
          user: user?.nama || user?.username || '-',
        };
      }),
      lowStockItems: barang
        .filter((item) => Number(item.stok) <= Number(item.stok_min))
        .slice(0, 5)
        .map((item) => hydrateBarang(item, store)),
    };
  }

  const [summary, activities, lowStock] = await Promise.all([
    query(
      `SELECT
        COUNT(*)::int AS total_barang,
        COALESCE(SUM(COALESCE(stok,0) * COALESCE(harga,0)),0)::numeric AS nilai_inventory,
        COUNT(*) FILTER (WHERE COALESCE(stok,0) <= COALESCE(stok_min,0))::int AS stok_menipis,
        (SELECT COUNT(*)::int FROM kartu_stok WHERE tanggal::date = CURRENT_DATE) AS total_transaksi
       FROM barang
       WHERE COALESCE(is_deleted, FALSE)=FALSE`,
    ),
    query(
      `SELECT k.id, k.tanggal, k.tipe, k.no_ref, k.qty, k.keterangan,
        COALESCE(b.nama, '-') AS barang,
        COALESCE(u.nama, u.username, '-') AS user
       FROM kartu_stok k
       LEFT JOIN barang b ON b.id=k.barang_id
       LEFT JOIN users u ON u.id=k.user_id
       ORDER BY k.tanggal DESC, k.id DESC
       LIMIT 5`,
    ),
    query(
      `SELECT b.id, b.kode, b.nama, b.stok, b.stok_min,
        json_build_object('id',s.id,'kode',s.kode,'nama',s.nama) AS satuan_detail
       FROM barang b
       LEFT JOIN satuan s ON s.id=b.satuan_id
       WHERE COALESCE(b.is_deleted, FALSE)=FALSE
         AND COALESCE(b.stok,0) <= COALESCE(b.stok_min,0)
       ORDER BY b.stok ASC, b.nama ASC
       LIMIT 5`,
    ),
  ]);

  const row = summary.rows[0] || {};
  return {
    totalBarang: Number(row.total_barang || 0),
    totalTransaksi: Number(row.total_transaksi || 0),
    stokMenipis: Number(row.stok_menipis || 0),
    nilaiInventory: Number(row.nilai_inventory || 0),
    aktivitasTerbaru: activities.rows,
    lowStockItems: lowStock.rows,
  };
}
