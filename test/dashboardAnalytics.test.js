import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardAnalytics, dashboardAnalyticsFromRows, dashboardRange, wibDate } from '../src/utils/dashboardAnalytics.js';

const now = new Date('2026-10-15T18:00:00Z');
const store = {
  barang: [{ id: 1, nama: 'Barang', kelompok_id: 10, satuan_id: 1 }, { id: 2, nama: 'Item B', kelompok_id: 20, satuan_id: 2 }, { id: 3, nama: 'Ungrouped' }, { id: 4, nama: 'Archived', kelompok_id: 10, is_deleted: true }],
  satuan: [{ id: 1, nama: 'pcs' }, { id: 2, nama: 'box' }],
  kelompok_barang: [{ id: 10, nama: 'Kelompok Barang' }, { id: 20, nama: 'Category B' }],
  pengambilan_barang: [
    { barang_id: 1, qty: 2, status: 'Disetujui', tanggal: '2026-10-15T17:30:00Z' },
    { barang_id: 1, qty: 3, status: 'Disetujui', tanggal: '2026-10-15T16:30:00Z' },
    { barang_id: 2, qty: 4, status: 'Disetujui', tanggal: '2026-10-10' },
    { barang_id: 2, qty: 1, status: 'Pending', tanggal: '2026-10-16' },
    { barang_id: 3, qty: 10, status: 'Ditolak', tanggal: '2026-10-15' },
    { barang_id: 2, qty: 8, status: 'Disetujui', tanggal: '2026-10-09T17:00:00Z' },
    { barang_id: 1, qty: 99, status: 'Disetujui', tanggal: '2026-10-09T16:59:59Z' },
    { barang_id: 1, qty: 5, status: 'Disetujui', tanggal: '2026-10-16T17:00:00Z' },
    { barang_id: 4, qty: 7, status: 'Disetujui', tanggal: '2026-10-14' },
  ],
  kartu_stok: [
    { tipe: 'Masuk', qty: 100, tanggal: '2026-10-15T17:00:00Z' },
    { tipe: 'Masuk', qty: 2, tanggal: '2026-10-16' },
    { tipe: 'Keluar', qty: 4, tanggal: '2026-10-16' },
    { tipe: 'Masuk', qty: 900, tanggal: '2026-09-01' },
  ],
};

test('dashboard periods use inclusive calendar days in WIB and exclusive end timestamps', () => {
  assert.equal(wibDate(now), '2026-10-16');
  assert.equal(wibDate('2026-10-15T16:59:59Z'), '2026-10-15');
  assert.equal(wibDate('2026-10-15'), '2026-10-15');
  assert.equal(wibDate('invalid'), null);
  assert.deepEqual(dashboardRange(7, now), { days: 7, startDate: '2026-10-10', endDate: '2026-10-16', start: '2026-10-10T00:00:00+07:00', end: '2026-10-17T00:00:00+07:00' });
});

test('approved withdrawal charts fill empty days and exclude pending, rejected and out-of-period requests', () => {
  const analytics = buildDashboardAnalytics(store, { days: 7, now });
  assert.equal(analytics.daily.length, 7);
  assert.deepEqual(analytics.daily.map(day => day.pengambilan), [2, 0, 0, 0, 1, 1, 1]);
  assert.deepEqual(analytics.daily.at(-1), { date: '2026-10-16', pengambilan: 1, masuk: 2, keluar: 1 });
  assert.deepEqual(Object.fromEntries(analytics.statuses.map(item => [item.status, item.total])), { Disetujui: 5, Pending: 1, Ditolak: 1 });
});

test('rankings retain item units and history, while categories exclude archived inventory', () => {
  const analytics = buildDashboardAnalytics(store, { days: 7, now });
  assert.deepEqual(analytics.popularItems, [
    { barang_id: 1, nama: 'Barang', satuan: 'pcs', total_transaksi: 2, total_qty: 5 },
    { barang_id: 2, nama: 'Item B', satuan: 'box', total_transaksi: 2, total_qty: 12 },
    { barang_id: 4, nama: 'Archived', satuan: '', total_transaksi: 1, total_qty: 7 },
  ]);
  assert.equal(analytics.categories.reduce((total, group) => total + group.total_barang, 0), 3);
  assert.equal(analytics.categories.find(group => group.kelompok_id === 10).total_barang, 1);
});

test('empty periods have zero-filled charts, and SQL numeric aggregates are normalized', () => {
  const empty = buildDashboardAnalytics({ barang: [], pengambilan_barang: [], kartu_stok: [] }, { days: 90, now });
  assert.equal(empty.daily.length, 90);
  assert.ok(empty.daily.every(day => day.pengambilan === 0 && day.masuk === 0 && day.keluar === 0));
  assert.deepEqual(empty.popularItems, []);
  const range = dashboardRange(7, now);
  const sql = dashboardAnalyticsFromRows({ dailyWithdrawals: [{ date: range.startDate, total: '3' }], dailyMovements: [{ date: range.startDate, masuk: '2', keluar: '1' }], popularItems: [{ total_transaksi: '3', total_qty: '12' }], categories: [{ total_barang: '4' }], statuses: [{ status: 'Pending', total: '2' }] }, range);
  assert.deepEqual(sql.daily[0], { date: range.startDate, pengambilan: 3, masuk: 2, keluar: 1 });
  assert.equal(sql.popularItems[0].total_qty, 12);
  assert.equal(sql.categories[0].total_barang, 4);
});
