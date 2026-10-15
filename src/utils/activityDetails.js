const labels = { nama_perusahaan: 'Nama perusahaan', alamat: 'Alamat', telepon: 'Telepon', email: 'Email', tema: 'Tema', bahasa: 'Bahasa', items_per_page: 'Data per halaman', auto_backup: 'Backup otomatis', session_timeout: 'Batas waktu sesi', two_factor: 'Verifikasi dua langkah', email_enabled: 'Notifikasi email', stock_enabled: 'Notifikasi stok', transaction_enabled: 'Notifikasi transaksi', level_ids: 'Level penerima', user_ids: 'Pengguna penerima' };
const display = value => {
  if (typeof value === 'boolean') return value ? 'Aktif' : 'Nonaktif';
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite).join(', ') || '-';
  return String(value ?? '-').slice(0, 1000);
};

export function settingsChanges(before, after, keys) {
  const changes = keys.filter(key => Object.hasOwn(labels, key) && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
  return changes.length ? changes.map(key => `${labels[key]}: ${display(before?.[key])} → ${display(after?.[key])}`).join('; ') : 'Disimpan tanpa perubahan nilai';
}
