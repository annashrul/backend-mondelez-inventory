# Inventory System - Mondelez

Aplikasi Inventory Management System sederhana.

## Tech Stack

- **Frontend**: React JS (Vite) + Tailwind CSS v4
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)

## Fitur

1. ✅ Dashboard - Overview statistik
2. ✅ Master Barang - CRUD data barang
3. ✅ Kelompok Barang - Kategori/kelompok barang
4. ✅ Master Rak Barang - Lokasi penyimpanan
5. ✅ Master Satuan Barang - Unit of measure
6. ✅ Master Pengguna - Manajemen user
7. ✅ Level Pengguna - Role & permission
8. ✅ Adjustment Stok - Penyesuaian stok
9. ✅ Kartu Stok - Riwayat barang masuk/keluar
10. ✅ Pengambilan Barang - Pencatatan pengambilan
11. ✅ Cetak Barcode/QR Code - Generate & print label
12. ✅ Log Activity - Audit trail
13. ✅ Closing Shift - Pergantian shift
14. ✅ Pengaturan - Konfigurasi sistem

## Instalasi & Menjalankan

### 1. Setup Database (Supabase)

1. Buat project baru di [supabase.com](https://supabase.com)
2. Buka **SQL Editor** di dashboard Supabase
3. Copy & paste isi file `database/schema.sql` lalu jalankan
4. Catat `Project URL` dan `API Key` dari Settings > API

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env dengan Supabase URL & Key Anda
npm install
npm run dev
```

Backend akan berjalan di `http://localhost:5000`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend akan berjalan di `http://localhost:5173`

### 4. Login

- **Username**: `admin`
- **Password**: `admin`

> Aplikasi sudah bisa dijalankan dalam **Demo Mode** tanpa konfigurasi Supabase.
> Semua data menggunakan dummy data di frontend.

## Struktur Folder

```
inventory-modelez/
├── frontend/              # React JS (Vite)
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── context/       # React Context (Auth)
│   │   ├── layouts/       # Layout wrapper
│   │   ├── pages/         # Halaman-halaman
│   │   ├── services/      # API service
│   │   ├── App.jsx        # Root component + routing
│   │   ├── main.jsx       # Entry point
│   │   └── index.css      # Tailwind CSS
│   └── vite.config.js
├── backend/               # Node.js (Express)
│   ├── src/
│   │   ├── config/        # Supabase config
│   │   ├── controllers/   # Business logic
│   │   ├── middleware/     # Auth middleware
│   │   ├── routes/        # API routes
│   │   └── server.js      # Entry point
│   ├── .env
│   └── .env.example
├── database/
│   └── schema.sql         # Database schema + seed
└── README.md
```

## Log request API

Jalankan `npm run dev` atau `npm start` dan lihat terminal backend. Pada VPS systemd, gunakan `journalctl -u backend-inventory -f -o cat`. Setiap request `/api/v1` dicatat setelah respons selesai, atau ketika koneksi dibatalkan. Header respons `X-Request-Id` cocok dengan request ID pada log.

Konfigurasi (dibaca saat request API pertama; restart setelah perubahan):

| Variable | Default | Pilihan |
| --- | --- | --- |
| `LOG_FORMAT` | `json` | `pretty`, `json`; nilai tidak valid kembali ke `json` |
| `LOG_LEVEL` | `info` | `info` (semua), `warn` (4xx/5xx), `error` (5xx saja) |
| `LOG_SHOW_OPTIONS` | `false` | `true` untuk mencatat OPTIONS sukses; OPTIONS error mengikuti LOG_LEVEL |
| `LOG_COLOR` | `auto` | `auto` (TTY, bukan TERM=dumb, tanpa NO_COLOR), `always`, `never` |

Pretty menggunakan waktu Asia/Jakarta (WIB), kolom method/path/status/durasi, request ID, dan penanda `aborted=true` jika dibatalkan. Banner ditampilkan sekali per instance logger, saat log pertama yang lolos filter. Padding path minimal 40 karakter; path lebih panjang tetap ditampilkan utuh. Durasi pretty dibulatkan ke milidetik, sementara JSON mempertahankan dua angka desimal.

```text
MONDELEZ INVENTORY — API REQUESTS
16:29:03  POST    /api/v1/auth/login                       200   1101ms  id=...
16:29:04  GET     /api/v1/notifications                    304    619ms  id=...
```

JSON mempertahankan nama field dan timestamp UTC:

```json
{"timestamp":"2026-10-14T09:29:03.503Z","level":"info","event":"api_request","request_id":"...","method":"POST","path":"/api/v1/auth/login","status":200,"duration_ms":1100.62,"aborted":false}
```

Status 4xx dicatat sebagai `warn`, 5xx sebagai `error`. Koneksi terputus sebelum respons selesai dicatat sebagai status log 499 dengan `aborted: true` (bukan respons HTTP yang dikirim). Pada `LOG_LEVEL=error`, 499 difilter karena termasuk 4xx. Body, query string, cookies, dan header autentikasi tidak dicatat. Karakter kontrol pada path dihapus untuk mencegah pemalsuan baris terminal. Logger tidak membuat file; penyimpanan/rotasi mengikuti journald atau process manager.

Untuk tampilan pretty di VPS, tambahkan konfigurasi berikut pada environment service (EnvironmentFile systemd atau `.env` aplikasi yang digunakan service):

```env
LOG_FORMAT=pretty
LOG_LEVEL=info
LOG_SHOW_OPTIONS=false
LOG_COLOR=auto
```

Output service systemd biasanya bukan TTY, sehingga `auto` tidak menambahkan ANSI dan tetap terbaca melalui journalctl. Gunakan `LOG_COLOR=always` jika ingin memaksa warna dan viewer mendukung ANSI, atau `never` untuk selalu tanpa warna.

Setelah kode baru tersedia di VPS, restart dengan `sudo systemctl restart backend-inventory`, periksa `sudo systemctl status backend-inventory`, lalu jalankan `journalctl -u backend-inventory -f -o cat`. Jika mengubah unit/drop-in systemd (bukan hanya EnvironmentFile atau `.env`), jalankan `sudo systemctl daemon-reload` sebelum restart.

## Email notifikasi pengambilan barang

Email menggunakan Nodemailer dan SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). Gmail memakai App Password. Port 587 memakai STARTTLS, port 465 memakai TLS langsung; `SMTP_SECURE` dapat diatur bila diperlukan.

Di Pengaturan → Notifikasi, aktifkan Notifikasi Email, pilih level/user penerima, lalu Simpan. Pengaturan disimpan sebagai `email_enabled` pada setting pengambilan barang. Isi alamat email pengguna melalui Master Pengguna. Hanya pengguna aktif yang dipilih melalui level atau user tambahan menerima email; alamat kosong/tidak valid dilewati dan alamat duplikat digabung. Penerima menggunakan BCC agar alamat mereka tidak saling terlihat.

Email dikirim setelah transaksi pengambilan dan notifikasi aplikasi tersimpan, berisi nomor referensi, barang, jumlah, pengambil, operator, rak, dan stok akhir. SMTP memiliki timeout. Kegagalan email tidak membatalkan transaksi; periksa event `notification_email` pada log backend untuk hasil atau kode error. Tidak ada retry/outbox persisten untuk email gagal. Mode test tidak mengirim email sungguhan.

Untuk memasang perubahan di VPS, install dependency dengan `npm ci`, pastikan konfigurasi SMTP tersedia pada environment backend, restart service, dan deploy perubahan frontend. Kredensial SMTP hanya disimpan di backend.
