# Audit pencarian Pengambilan Barang

Tabel PostgreSQL: `public.search_audit`. Satu baris mewakili satu permintaan pencarian yang mencapai backend. Pencarian Master Barang biasa tidak masuk audit ini.

## Aktivasi

Jalankan `npm run db:migrate:search-audit` pada setiap database sebelum deploy backend dan frontend. Migrasi idempoten dan tidak menghapus data. Tabel mengaktifkan RLS tanpa policy publik; aplikasi mengakses melalui koneksi PostgreSQL backend. Migrasi khusus ini juga diperlukan pada instalasi baru.

Buka **Pengambilan Barang → Audit Pencarian**. Tab dan API daftar memerlukan hak `log.read`. Filter tanggal memakai awal dan akhir hari di zona waktu browser; backend memakai interval awal inklusif/akhir eksklusif. Default 30 hari terakhir. Ringkasan dihitung atas seluruh baris yang memenuhi filter, bukan hanya halaman saat ini.

## Data

- `method`: `camera`, `gallery`, `voice`, `text`, `rack`. Kamera dan upload galeri memakai mesin AI yang sama, tetapi dicatat terpisah.
- `query_text`: query teks final yang dikirim untuk pencarian atau kode QR. Tidak menyimpan audio atau foto/base64.
- `status`: `found`, `not_found`, `error`. Katalog tanpa embedding yang sesuai model masuk `not_found`, dengan kode `NO_COMPATIBLE_EMBEDDINGS` agar dapat dibedakan dari hasil yang ditolak ambang.
- `http_status`, `error_code`, `duration_ms`: hasil HTTP dan waktu proses server sampai respons siap, sebelum penulisan audit. Bukan waktu end-to-end browser atau waktu pengguna berbicara.
- `result_count`: total kecocokan teks sebelum pagination, atau jumlah hasil akhir gambar/rak. `returned_count`: jumlah hasil dalam respons.
- `results`: snapshot rekomendasi yang dikirim (maksimal 100), termasuk ID, nama, kode, urutan, dan skor kemiripan/jarak jika tersedia. Snapshot tetap dapat ditinjau sesudah barang berubah.
- `model`: model AI yang dilaporkan respons pencarian gambar.
- `selected_item_id`, `selected_rank`: barang yang dipilih saat melanjutkan. Pemilihan saja tidak dihitung sebagai penilaian benar.
- `relevance`, `reviewed_at`: penilaian eksplisit **Sesuai / Tidak sesuai**. Nilai NULL berarti belum dinilai. Penilaian positif harus menunjuk barang yang ada dalam snapshot; pengguna hanya dapat menilai pencariannya sendiri. Perubahan pilihan mereset penilaian agar penilaian lama tidak disematkan ke pilihan berbeda. Error sistem tidak dapat dinilai sebagai relevansi.

## Metrik

- Rasio tidak ditemukan = `not_found / (found + not_found) × 100`. Error sistem dikecualikan.
- Akurasi dinilai = `relevance=true / jumlah relevance bukan NULL × 100`.
- Cakupan penilaian = `jumlah dinilai / total pencarian × 100` (tersedia di API; UI menampilkan jumlah dinilai dibanding total).
- Rasio error = `error / total pencarian × 100` (tersedia di API).
- Rata-rata respons = rata-rata `duration_ms` seluruh pencarian dalam filter, termasuk error.

Tanpa sampel atau penilaian, persentase bernilai NULL/“—”, bukan 0% atau 100%. Akurasi dinilai mencerminkan relevansi menurut pengguna yang memberi umpan balik, bukan jaminan akurasi seluruh pencarian atau model pengenal suara. Skor kemiripan tidak dianggap probabilitas akurasi.

Data baru dicatat setelah fitur aktif; riwayat lama tidak dapat direkonstruksi. Pembatalan pengenalan suara, izin mikrofon, validasi foto di browser, dan kegagalan jaringan sebelum request mencapai backend tidak tercatat sebagai pencarian database. Disconnect yang terdeteksi sebelum respons siap dicatat sebagai error HTTP 499. Kegagalan penulisan audit dicatat di log `search_audit_write_failed` dan tidak menggagalkan pencarian; sampel tersebut tidak masuk ringkasan.

## API

- `GET /api/v1/search-audit?from=...&to=...&method=voice&status=not_found&page=1&limit=20`: baris audit dan ringkasan per metode; memerlukan `log.read`.
- `PATCH /api/v1/search-audit/:id/feedback`: `{ "verdict": "correct" | "incorrect" | "selected", "item_id": 123 }`; memerlukan `pengambilan.read` dan kepemilikan audit. `item_id` opsional untuk penilaian negatif.
- Query teks dari alur pengambilan memakai `search_method=voice|text`. Gambar mengirim `search_method=camera|gallery`. Respons mengembalikan `search_audit_id` bila pencatatan berhasil.
