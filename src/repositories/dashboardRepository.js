import { buildDashboardAnalytics, dashboardAnalyticsFromRows, dashboardRange, wibDate } from '../utils/dashboardAnalytics.js';
import { query } from '../config/database.js';
import { readStore } from '../config/store.js';

const useTestStore = process.env.NODE_ENV === 'test';

function hydrateBarang(item, store) {
  const satuan = (store.units || []).find((row) => Number(row.id) === Number(item.satuan_id));
  return {
    ...item,
    satuan_detail: satuan ? { id: satuan.id, kode: satuan.kode, nama: satuan.nama } : null,
  };
}

export async function getDashboardStats({ days = 30, now = new Date() } = {}) {
  const range = dashboardRange(days, now);
  if (useTestStore) {
    const store = await readStore();
    const barang = (store.items || []).filter((item) => !item.is_deleted);
    const today = wibDate(now);
    const kartuStok = [...(store.stock_movements || [])].sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || Number(b.id) - Number(a.id));
    const users = store.users || [];

    return {
      analytics: buildDashboardAnalytics(store, { days, now }),
      totalBarang: barang.length,
      totalTransaksi: kartuStok.filter((item) => wibDate(item.tanggal) === today).length,
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

  const [summary, activities, lowStock, withdrawals, movements, popular, categories, statuses] = await Promise.all([
    query(
      `SELECT
        COUNT(*)::int AS total_barang,
        COALESCE(SUM(COALESCE(stok,0) * COALESCE(harga,0)),0)::numeric AS nilai_inventory,
        COUNT(*) FILTER (WHERE COALESCE(stok,0) <= COALESCE(stok_min,0))::int AS stok_menipis,
        (SELECT COUNT(*)::int FROM stock_movements WHERE (tanggal::timestamptz AT TIME ZONE 'Asia/Jakarta')::date = $1::date) AS total_transaksi
       FROM items
       WHERE COALESCE(is_deleted, FALSE)=FALSE`, [range.endDate],
    ),
    query(
      `SELECT k.id, k.tanggal, k.tipe, k.no_ref, k.qty, k.keterangan,
        COALESCE(b.nama, '-') AS barang,
        COALESCE(u.nama, u.username, '-') AS user
       FROM stock_movements k
       LEFT JOIN items b ON b.id=k.barang_id
       LEFT JOIN users u ON u.id=k.user_id
       ORDER BY k.tanggal DESC, k.id DESC
       LIMIT 5`,
    ),
    query(
      `SELECT b.id, b.kode, b.nama, b.stok, b.stok_min,
        json_build_object('id',s.id,'kode',s.kode,'nama',s.nama) AS satuan_detail
       FROM items b
       LEFT JOIN units s ON s.id=b.satuan_id
       WHERE COALESCE(b.is_deleted, FALSE)=FALSE
         AND COALESCE(b.stok,0) <= COALESCE(b.stok_min,0)
       ORDER BY b.stok ASC, b.nama ASC
       LIMIT 5`,
    ),
    query(
      `SELECT to_char(tanggal::timestamptz AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS date, COUNT(*)::int AS total
       FROM withdrawals WHERE tanggal::timestamptz >= $1::timestamptz AND tanggal::timestamptz < $2::timestamptz AND status='Disetujui'
       GROUP BY 1 ORDER BY 1`, [range.start, range.end],
    ),
    query(
      `SELECT to_char(tanggal::timestamptz AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS date,
        COUNT(*) FILTER (WHERE tipe='Masuk')::int AS masuk, COUNT(*) FILTER (WHERE tipe='Keluar')::int AS keluar
       FROM stock_movements WHERE tanggal::timestamptz >= $1::timestamptz AND tanggal::timestamptz < $2::timestamptz GROUP BY 1 ORDER BY 1`, [range.start, range.end],
    ),
    query(
      `SELECT p.barang_id, COALESCE(b.nama,'-') AS nama, COALESCE(s.nama,'') AS satuan,
        COUNT(*)::int AS total_transaksi, COALESCE(SUM(p.qty),0)::numeric AS total_qty
       FROM withdrawals p LEFT JOIN items b ON b.id=p.barang_id LEFT JOIN units s ON s.id=b.satuan_id
       WHERE p.tanggal::timestamptz >= $1::timestamptz AND p.tanggal::timestamptz < $2::timestamptz AND p.status='Disetujui'
       GROUP BY p.barang_id,b.nama,s.nama ORDER BY total_transaksi DESC,p.barang_id LIMIT 5`, [range.start, range.end],
    ),
    query(
      `SELECT b.kelompok_id,k.nama,COUNT(*)::int AS total_barang
       FROM items b LEFT JOIN item_groups k ON k.id=b.kelompok_id WHERE COALESCE(b.is_deleted,FALSE)=FALSE
       GROUP BY b.kelompok_id,k.nama ORDER BY total_barang DESC,b.kelompok_id`,
    ),
    query(
      `SELECT status,COUNT(*)::int AS total FROM withdrawals
       WHERE tanggal::timestamptz >= $1::timestamptz AND tanggal::timestamptz < $2::timestamptz GROUP BY status`, [range.start, range.end],
    ),
  ]);

  const row = summary.rows[0] || {};
  return {
    analytics: dashboardAnalyticsFromRows({ dailyWithdrawals: withdrawals.rows, dailyMovements: movements.rows, popularItems: popular.rows, categories: categories.rows, statuses: statuses.rows }, range),
    totalBarang: Number(row.total_barang || 0),
    totalTransaksi: Number(row.total_transaksi || 0),
    stokMenipis: Number(row.stok_menipis || 0),
    nilaiInventory: Number(row.nilai_inventory || 0),
    aktivitasTerbaru: activities.rows,
    lowStockItems: lowStock.rows,
  };
}
