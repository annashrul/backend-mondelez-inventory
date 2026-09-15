# API Contract untuk Sistem Inventory

Dokumen ini menjelaskan struktur data dan endpoint yang digunakan oleh Frontend. Backend harus menyediakan endpoint yang sesuai dengan kontrak ini.

## Base URL
`/api/v1`

## Autentikasi
Sebagian besar endpoint memerlukan header `Authorization: Bearer <token>`.

### 1. Auth
- **POST `/auth/login`**
  - **Request Body**: `{ username, password }`
  - **Response 200**: `{ user: { id, username, nama, level, status }, token }`

## Format Standar CRUD (berlaku untuk semua master data)

Setiap entitas memiliki 5 operasi standar:
- **GET `/:entity`** -> Response 200: `[ { item1 }, { item2 }, ... ]`
- **GET `/:entity/:id`** -> Response 200: `{ item }`
- **POST `/:entity`** -> Response 201: `{ item }` (Mengembalikan data yang baru dibuat)
- **PUT `/:entity/:id`** -> Response 200: `{ item }` (Mengembalikan data yang sudah diupdate)
- **DELETE `/:entity/:id`** -> Response 200: `{ message: 'Berhasil dihapus' }`

## Entitas & Skema Data

### 1. Master Barang (`/barang`)
```json
{
  "id": 1,
  "kode": "BRG-001",
  "barcode": "8991001000011",
  "nama": "Kertas A4 70gsm",
  "kelompok": "Alat Tulis Kantor",
  "satuan": "Rim",
  "rak": "Rak A-01",
  "stok": 150,
  "stok_min": 50,
  "harga": 45000
}
```

Ketentuan field `barcode`:
- Bertipe string dengan panjang maksimum 100 karakter.
- Wajib dikirim pada **POST `/barang`** dari halaman Master Barang.
- Dapat diperbarui melalui **PUT `/barang/:id`**.
- Harus unik jika nilainya tidak kosong; duplikasi mengembalikan status `409`.
- **GET `/barang?search=:query`** mencari barang berdasarkan `kode`, `barcode`, atau `nama` (case-insensitive).

Contoh request **POST `/barang`**:
```json
{
  "kode": "BRG-001",
  "barcode": "8991001000011",
  "nama": "Kertas A4 70gsm",
  "kelompok": "Alat Tulis Kantor",
  "satuan": "Rim",
  "rak": "Rak A-01",
  "stok": 150,
  "stok_min": 50,
  "harga": 45000
}
```

### 2. Kelompok Barang (`/kelompok-barang`)
```json
{
  "id": 1,
  "kode": "KLP-001",
  "nama": "Alat Tulis Kantor",
  "deskripsi": "Perlengkapan tulis menulis",
  "jumlah_barang": 45
}
```

### 3. Satuan (`/satuan`)
```json
{
  "id": 1,
  "kode": "STN-001",
  "nama": "Pcs",
  "deskripsi": "Satuan per buah/piece"
}
```

### 4. Lokasi (`/lokasi`)
```json
{
  "id": 1,
  "kode": "LOK-001",
  "nama": "Gudang Utama - Lantai 1",
  "alamat": "Gedung A, Lantai 1",
  "deskripsi": "Gudang lantai dasar",
  "jumlah_rak": 4
}
```

### 5. Rak (`/rak`)
```json
{
  "id": 1,
  "kode": "RAK-A01",
  "qr_code": "RAK:RAK-A01",
  "nama": "Rak A-01",
  "lokasi": "Gudang Utama - Lantai 1",
  "kapasitas": 100,
  "terisi": 65
}
```

### 6. Pengguna (`/pengguna`)
Create menerima `username`, `password` (minimal 8 karakter), `nama`, `email`, `level_id`, dan `status` (`Aktif`/`Nonaktif`). Update menggunakan field yang sama; `password` boleh dikosongkan/tidak dikirim agar password lama dipertahankan. Field password/hash tidak pernah dikembalikan.
```json
{
  "id": 1,
  "username": "admin",
  "nama": "Administrator",
  "email": "admin@company.com",
  "level_id": "1",
  "level": "Admin",
  "status": "Aktif",
  "level_detail": { "id": "1", "kode": "LVL-001", "nama": "Admin" },
  "permissions": ["dashboard.read", "pengguna.read"]
}
```

### 7. Level Pengguna (`/level-pengguna`)
Create/update menerima `{ "kode", "nama", "deskripsi", "action_ids": [] }`. Setiap action ID wajib tersedia dan aktif. Penghapusan ditolak dengan `409` jika level masih digunakan pengguna.
```json
{
  "id": 1,
  "kode": "LVL-001",
  "nama": "Admin",
  "deskripsi": "Akses penuh",
  "hak_akses": "41 permission",
  "action_ids": ["101", "701"],
  "permissions": ["dashboard.read", "pengguna.read"],
  "jumlah_user": 1
}
```

### 7a. Katalog Menu dan Aksi (`GET /menus`)
Katalog ini menjadi sumber pilihan hak akses pada Level Pengguna. Nilai permission dibentuk
dari `<menu.key>.<action.key>` dan tidak perlu didefinisikan ulang di form.

```json
[
  {
    "id": 7,
    "key": "pengguna",
    "nama": "Master Pengguna",
    "grup": "Pengguna",
    "path": "/master-pengguna",
    "urutan": 7,
    "aktif": true,
    "actions": [
      { "id": 701, "key": "read", "nama": "Lihat", "permission": "pengguna.read", "urutan": 1 },
      { "id": 702, "key": "create", "nama": "Tambah", "permission": "pengguna.create", "urutan": 2 }
    ]
  }
]
```

### 8. Adjustment Stok (`/adjustment`)
```json
{
  "id": 1,
  "tanggal": "2026-09-10",
  "no_ref": "ADJ-001",
  "barang": "Kertas A4",
  "tipe": "Tambah",
  "qty": 10,
  "alasan": "Koreksi",
  "user": "Admin"
}
```

### 9. Kartu Stok (`/kartu-stok`)
```json
{
  "id": 1,
  "tanggal": "2026-09-10T08:30:00Z",
  "tipe": "Masuk",
  "no_ref": "IN-001",
  "barang": "Kertas A4",
  "qty": 100,
  "saldo": 250,
  "keterangan": "Pembelian",
  "user": "Admin"
}
```

### 10. Pengambilan Barang (`/pengambilan`)
```json
{
  "id": 1,
  "tanggal": "2026-09-10",
  "no_ref": "AMB-001",
  "pemohon": "Dept. HRD",
  "barang": "Kertas A4",
  "qty": 50,
  "status": "Disetujui",
  "user": "Budi"
}
```

#### Alur operasional pengambilan
- **POST `/ai/search-image`** — body `{ image: "data:image/...;base64,...", limit: 5 }`; backend mengambil embedding katalog lalu memanggil `ai-service POST /search`. Response `{ model, results: [{ id, kode, nama, rak, rak_detail, stok, satuan, confidence }] }`.
- **POST `/rak/scan`** — body `{ qr_code, barang_id }`; memastikan QR terdaftar dan rak sama dengan rak barang. Response `{ valid, rak, barang }`; rak salah mengembalikan `409`.
- **POST `/pengambilan/execute`** — body `{ barang_id, rak_id, qr_code, pemohon, qty, keterangan }`. Endpoint wajib dijalankan dalam satu database transaction: lock stok barang, validasi QR/rak/qty, kurangi stok, insert pengambilan, kartu stok, dan log activity. Response `201`: `{ transaction, stok_akhir }`.

`operator_id` dan `user_name` harus diambil dari JWT/session, tidak boleh dipercaya dari request body.

### 11. Log Activity (`/log-activity`)
```json
{
  "id": 1,
  "waktu": "2026-09-10T14:30:22Z",
  "user": "Admin",
  "aksi": "Login",
  "modul": "Auth",
  "detail": "Login berhasil",
  "ip": "192.168.1.100"
}
```

### 12. Shift / Closing (`/shift`)
```json
{
  "id": 1,
  "shift": "Pagi",
  "tanggal": "2026-09-10",
  "waktu_closing": "14:00",
  "user": "Admin",
  "total_transaksi": 32,
  "status": "Selesai"
}
```

## Dashboard Stats
- **GET `/dashboard/stats`**
  - **Response 200**:
```json
{
  "totalBarang": 1248,
  "totalTransaksi": 64,
  "stokMenipis": 23,
  "nilaiInventory": 2400000,
  "aktivitasTerbaru": [ ... array of kartu_stok ... ],
  "lowStockItems": [ ... array of barang ... ]
}
```