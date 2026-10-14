const dayMilliseconds = 86400000;
const wibOffset = 7 * 3600000;

export function wibDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + wibOffset).toISOString().slice(0, 10) : null;
}

export function dashboardRange(days = 30, now = new Date()) {
  const endDate = wibDate(now);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const startDate = new Date(end - (days - 1) * dayMilliseconds).toISOString().slice(0, 10);
  const nextDate = new Date(end + dayMilliseconds).toISOString().slice(0, 10);
  return { days, startDate, endDate, start: `${startDate}T00:00:00+07:00`, end: `${nextDate}T00:00:00+07:00` };
}

export function dashboardAnalyticsFromRows({ dailyWithdrawals = [], dailyMovements = [], popularItems = [], categories = [], statuses = [] }, range) {
  const withdrawals = new Map(dailyWithdrawals.map(row => [row.date, Number(row.total)]));
  const movements = new Map(dailyMovements.map(row => [row.date, row]));
  const firstDay = Date.parse(`${range.startDate}T00:00:00Z`);
  const daily = Array.from({ length: range.days }, (_, index) => {
    const date = new Date(firstDay + index * dayMilliseconds).toISOString().slice(0, 10);
    const movement = movements.get(date);
    return { date, pengambilan: withdrawals.get(date) || 0, masuk: Number(movement?.masuk || 0), keluar: Number(movement?.keluar || 0) };
  });
  return {
    days: range.days, startDate: range.startDate, endDate: range.endDate, daily,
    popularItems: popularItems.map(item => ({ ...item, total_transaksi: Number(item.total_transaksi), total_qty: Number(item.total_qty) })),
    categories: categories.map(item => ({ ...item, total_barang: Number(item.total_barang) })),
    statuses: statuses.map(item => ({ ...item, total: Number(item.total) })),
  };
}

export function buildDashboardAnalytics(store, { days = 30, now = new Date() } = {}) {
  const range = dashboardRange(days, now);
  const inRange = row => {
    const date = wibDate(row.tanggal || row.created_at);
    return date && date >= range.startDate && date <= range.endDate;
  };
  const requests = (store.pengambilan_barang || store.pengambilan || []).filter(inRange);
  const dailyWithdrawals = new Map();
  const dailyMovements = new Map();
  const popular = new Map();
  const statuses = new Map();
  for (const transaction of requests) {
    statuses.set(transaction.status, (statuses.get(transaction.status) || 0) + 1);
    if (transaction.status !== 'Disetujui') continue;
    const date = wibDate(transaction.tanggal || transaction.created_at);
    dailyWithdrawals.set(date, (dailyWithdrawals.get(date) || 0) + 1);
    const product = (store.barang || []).find(item => Number(item.id) === Number(transaction.barang_id));
    const unit = (store.satuan || []).find(item => Number(item.id) === Number(product?.satuan_id));
    const item = popular.get(transaction.barang_id) || { barang_id: transaction.barang_id, nama: product?.nama || '-', satuan: unit?.nama || '', total_transaksi: 0, total_qty: 0 };
    item.total_transaksi++;
    item.total_qty += Number(transaction.qty || 0);
    popular.set(transaction.barang_id, item);
  }
  for (const transaction of (store.kartu_stok || []).filter(inRange)) {
    if (!['Masuk', 'Keluar'].includes(transaction.tipe)) continue;
    const date = wibDate(transaction.tanggal);
    const counts = dailyMovements.get(date) || { date, masuk: 0, keluar: 0 };
    counts[transaction.tipe === 'Masuk' ? 'masuk' : 'keluar']++;
    dailyMovements.set(date, counts);
  }
  const categories = new Map();
  for (const product of (store.barang || []).filter(item => !item.is_deleted)) {
    const id = product.kelompok_id || null;
    const group = (store.kelompok_barang || []).find(item => Number(item.id) === Number(id));
    const category = categories.get(id) || { kelompok_id: id, nama: group?.nama || null, total_barang: 0 };
    category.total_barang++;
    categories.set(id, category);
  }
  return dashboardAnalyticsFromRows({
    dailyWithdrawals: [...dailyWithdrawals].map(([date, total]) => ({ date, total })),
    dailyMovements: [...dailyMovements.values()],
    popularItems: [...popular.values()].sort((a, b) => b.total_transaksi - a.total_transaksi || Number(a.barang_id) - Number(b.barang_id)).slice(0, 5),
    categories: [...categories.values()].sort((a, b) => b.total_barang - a.total_barang || Number(a.kelompok_id) - Number(b.kelompok_id)),
    statuses: [...statuses].map(([status, total]) => ({ status, total })),
  }, range);
}
