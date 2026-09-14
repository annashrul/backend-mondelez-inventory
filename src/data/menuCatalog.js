export const menuCatalog = [
  { key: 'dashboard', nama: 'Dashboard', grup: 'Utama', path: '/', actions: [['read', 'Lihat']] },
  { key: 'barang', nama: 'Master Barang', grup: 'Master Data', path: '/master-barang', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'kelompok', nama: 'Kelompok Barang', grup: 'Master Data', path: '/kelompok-barang', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'satuan', nama: 'Master Satuan', grup: 'Master Data', path: '/master-satuan', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'lokasi', nama: 'Master Lokasi', grup: 'Master Data', path: '/master-lokasi', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'rak', nama: 'Master Rak', grup: 'Master Data', path: '/master-rak', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'pengguna', nama: 'Master Pengguna', grup: 'Pengguna', path: '/master-pengguna', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'level', nama: 'Level Pengguna', grup: 'Pengguna', path: '/level-pengguna', actions: [['read', 'Lihat'], ['create', 'Tambah'], ['update', 'Ubah'], ['delete', 'Hapus']] },
  { key: 'adjustment', nama: 'Adjustment Stok', grup: 'Transaksi', path: '/adjustment-stok', actions: [['read', 'Lihat'], ['create', 'Buat Adjustment']] },
  { key: 'kartu', nama: 'Kartu Stok', grup: 'Transaksi', path: '/kartu-stok', actions: [['read', 'Lihat']] },
  { key: 'pengambilan', nama: 'Pengambilan Barang', grup: 'Transaksi', path: '/pengambilan-barang', actions: [['read', 'Lihat'], ['create', 'Proses Pengambilan']] },
  { key: 'barcode', nama: 'Cetak Barcode/QR', grup: 'Lainnya', path: '/cetak-barcode', actions: [['read', 'Lihat'], ['print', 'Cetak']] },
  { key: 'log', nama: 'Log Activity', grup: 'Lainnya', path: '/log-activity', actions: [['read', 'Lihat']] },
  { key: 'closing', nama: 'Closing Shift', grup: 'Lainnya', path: '/closing', actions: [['read', 'Lihat'], ['close', 'Closing Shift']] },
  { key: 'pengaturan', nama: 'Pengaturan', grup: 'Lainnya', path: '/pengaturan', actions: [['read', 'Lihat'], ['update', 'Ubah']] },
];

export function catalogWithIds() {
  return menuCatalog.map((menu, menuIndex) => ({
    id: menuIndex + 1,
    key: menu.key,
    nama: menu.nama,
    grup: menu.grup,
    path: menu.path,
    urutan: menuIndex + 1,
    aktif: true,
    actions: menu.actions.map(([key, nama], actionIndex) => ({
      id: (menuIndex + 1) * 100 + actionIndex + 1,
      key,
      nama,
      permission: `${menu.key}.${key}`,
      urutan: actionIndex + 1,
    })),
  }));
}