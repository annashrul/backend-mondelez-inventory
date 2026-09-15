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
