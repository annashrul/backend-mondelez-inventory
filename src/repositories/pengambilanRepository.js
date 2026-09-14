import { pool, query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';

const useTestStore = process.env.NODE_ENV === 'test';

const barangFields = `b.id, b.kode, b.barcode, b.nama,
  b.kelompok_id, b.satuan_id, b.rak_id,
  json_build_object('id',k.id,'kode',k.kode,'nama',k.nama) AS kelompok_detail,
  json_build_object('id',s.id,'kode',s.kode,'nama',s.nama) AS satuan_detail,
  json_build_object('id',r.id,'kode',r.kode,'nama',r.nama,'qr_code',r.qr_code,'lokasi_id',r.lokasi_id,
    'lokasi_detail', json_build_object('id',l.id,'kode',l.kode,'nama',l.nama)) AS rak_detail,
  b.stok, b.stok_min, b.harga, b.image_url, b.embedding_model, (b.embedding IS NOT NULL) AS has_embedding`;

const barangJoins = `LEFT JOIN kelompok_barang k ON k.id=b.kelompok_id
  LEFT JOIN satuan s ON s.id=b.satuan_id
  LEFT JOIN rak r ON r.id=b.rak_id
  LEFT JOIN lokasi l ON l.id=r.lokasi_id`;

const historyFields = `p.id, p.tanggal, p.no_ref, p.pemohon, p.barang_id, p.rak_id, p.operator_id, p.qr_code,
  p.qty, p.keterangan, p.status, p.created_at,
  json_build_object('id',b.id,'kode',b.kode,'nama',b.nama) AS barang_detail,
  json_build_object('id',r.id,'kode',r.kode,'nama',r.nama,'qr_code',r.qr_code,'lokasi_id',r.lokasi_id,
    'lokasi_detail', json_build_object('id',l.id,'kode',l.kode,'nama',l.nama)) AS rak_detail,
  json_build_object('id',u.id,'username',u.username,'nama',u.nama) AS operator_detail`;

function nextReference() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AMB-${date}-${random}`;
}

function hydrateBarang(item, store) {
  const rak = store.rak.find((row) => row.id === Number(item.rak_id));
  return {
    ...item,
    kelompok_detail: store.kelompok_barang.find((row) => row.id === Number(item.kelompok_id)) || null,
    satuan_detail: store.satuan.find((row) => row.id === Number(item.satuan_id)) || null,
    rak_detail: rak ? { ...rak, lokasi_detail: store.lokasi.find((row) => row.id === Number(rak.lokasi_id)) || null } : null,
  };
}

function hydrateHistory(item, store) {
  return {
    ...item,
    barang_detail: hydrateBarang(store.barang.find((row) => row.id === Number(item.barang_id)) || {}, store),
    rak_detail: (() => {
      const rak = store.rak.find((row) => row.id === Number(item.rak_id));
      return rak ? { ...rak, lokasi_detail: store.lokasi.find((row) => row.id === Number(rak.lokasi_id)) || null } : null;
    })(),
    operator_detail: store.users?.find((row) => row.id === Number(item.operator_id)) || null,
  };
}

export async function searchBarangByImageEmbedding(embedding, limit) {
  if (useTestStore) {
    const store = await readStore();
    return store.barang.slice(0, limit).map((item, index) => ({
      ...hydrateBarang(item, store),
      confidence: Math.max(0.91 - index * 0.09, 0.55),
    }));
  }
  const result = await query(
    `WITH q AS (SELECT $1::extensions.vector AS embedding)
     SELECT ${barangFields}, GREATEST(0, LEAST(1, 1 - (b.embedding <=> q.embedding))) AS confidence
     FROM barang b ${barangJoins}, q
     WHERE b.embedding IS NOT NULL AND COALESCE(b.is_deleted, FALSE)=FALSE
     ORDER BY b.embedding <=> q.embedding
     LIMIT $2`,
    [JSON.stringify(embedding), limit],
  );
  return result.rows;
}

export async function listPengambilan(search = '') {
  const term = search.trim().toLowerCase();
  if (useTestStore) {
    const store = await readStore();
    return [...(store.pengambilan_barang || store.pengambilan || [])]
      .reverse()
      .map((item) => hydrateHistory(item, store))
      .filter((item) => !term || `${item.no_ref} ${item.pemohon} ${item.barang_detail?.nama || ''} ${item.rak_detail?.nama || ''}`.toLowerCase().includes(term));
  }
  return (await query(
    `SELECT ${historyFields}
     FROM pengambilan_barang p
     LEFT JOIN barang b ON b.id=p.barang_id
     LEFT JOIN rak r ON r.id=p.rak_id
     LEFT JOIN lokasi l ON l.id=r.lokasi_id
     LEFT JOIN users u ON u.id=p.operator_id
     WHERE $1 = '' OR p.no_ref ILIKE '%' || $1 || '%' OR p.pemohon ILIKE '%' || $1 || '%' OR b.nama ILIKE '%' || $1 || '%' OR r.nama ILIKE '%' || $1 || '%'
     ORDER BY p.created_at DESC, p.id DESC
    `,
    [search.trim()],
  )).rows;
}

export async function verifyRackForBarang(qrCode, barangId) {
  if (useTestStore) {
    const store = await readStore();
    const rak = store.rak.find((row) => [row.qr_code, row.kode].includes(qrCode));
    const barang = store.barang.find((row) => row.id === Number(barangId) && !row.is_deleted);
    if (!rak) return { status: 'rack-missing' };
    if (!barang) return { status: 'barang-missing' };
    if (Number(barang.rak_id) !== Number(rak.id)) return { status: 'wrong-rack', barang: hydrateBarang(barang, store) };
    return { status: 'ok', rak: hydrateBarang(barang, store).rak_detail, barang: hydrateBarang(barang, store) };
  }
  const result = await query(
    `SELECT ${barangFields}
     FROM barang b ${barangJoins}
     WHERE b.id=$2 AND COALESCE(b.is_deleted, FALSE)=FALSE AND (r.qr_code=$1 OR r.kode=$1)`,
    [qrCode, barangId],
  );
  if (result.rowCount) return { status: 'ok', barang: result.rows[0], rak: result.rows[0].rak_detail };

  const rack = await query(
    `SELECT r.*, json_build_object('id',l.id,'kode',l.kode,'nama',l.nama) AS lokasi_detail
     FROM rak r JOIN lokasi l ON l.id=r.lokasi_id WHERE r.qr_code=$1 OR r.kode=$1`,
    [qrCode],
  );
  const barang = await query(`SELECT ${barangFields} FROM barang b ${barangJoins} WHERE b.id=$1 AND COALESCE(b.is_deleted, FALSE)=FALSE`, [barangId]);
  if (!rack.rowCount) return { status: 'rack-missing' };
  if (!barang.rowCount) return { status: 'barang-missing' };
  return { status: 'wrong-rack', barang: barang.rows[0], rack: rack.rows[0] };
}

export async function executePengambilan(payload, operatorId, ip) {
  if (useTestStore) return updateStore((store) => {
    const barang = store.barang.find((row) => row.id === Number(payload.barang_id) && !row.is_deleted);
    const rak = store.rak.find((row) => row.id === Number(payload.rak_id));
    if (!barang || !rak) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    if (Number(barang.rak_id) !== Number(rak.id) || payload.qr_code !== rak.qr_code) throw Object.assign(new Error('wrong rack'), { code: 'WRONG_RACK' });
    if (payload.qty > barang.stok) throw Object.assign(new Error('stock'), { code: 'INSUFFICIENT_STOCK', stock: barang.stok });
    barang.stok -= payload.qty;
    const noRef = nextReference();
    const transaction = {
      id: Date.now(), tanggal: new Date().toISOString(), no_ref: noRef, pemohon: payload.pemohon,
      barang_id: barang.id, rak_id: rak.id, operator_id: operatorId, qr_code: rak.qr_code,
      qty: payload.qty, keterangan: payload.keterangan, status: 'Disetujui',
    };
    store.pengambilan_barang ||= [];
    store.pengambilan_barang.push(transaction);
    return { transaction: hydrateHistory(transaction, store), stok_akhir: barang.stok };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT b.*, r.qr_code, r.kode AS rak_kode, r.nama AS rak_nama, s.nama AS satuan_nama
       FROM barang b JOIN rak r ON r.id=b.rak_id LEFT JOIN satuan s ON s.id=b.satuan_id
       WHERE b.id=$1 AND COALESCE(b.is_deleted, FALSE)=FALSE FOR UPDATE OF b`,
      [payload.barang_id],
    );
    if (!locked.rowCount) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    const barang = locked.rows[0];
    if (Number(barang.rak_id) !== Number(payload.rak_id) || ![barang.qr_code, barang.rak_kode].includes(payload.qr_code)) {
      throw Object.assign(new Error('wrong rack'), { code: 'WRONG_RACK' });
    }
    if (payload.qty > barang.stok) throw Object.assign(new Error('stock'), { code: 'INSUFFICIENT_STOCK', stock: barang.stok, satuan: barang.satuan_nama });

    const noRef = nextReference();
    const newStock = Number(barang.stok) - payload.qty;
    await client.query('UPDATE barang SET stok=$1 WHERE id=$2', [newStock, payload.barang_id]);
    const transaction = await client.query(
      `INSERT INTO pengambilan_barang(no_ref,pemohon,barang_id,rak_id,operator_id,qr_code,qty,keterangan,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Disetujui') RETURNING id`,
      [noRef, payload.pemohon, payload.barang_id, payload.rak_id, operatorId, barang.qr_code, payload.qty, payload.keterangan],
    );
    await client.query(
      `INSERT INTO kartu_stok(tipe,no_ref,barang_id,user_id,qty,saldo,keterangan)
       VALUES('Keluar',$1,$2,$3,$4,$5,$6)`,
      [noRef, payload.barang_id, operatorId, payload.qty, newStock, `Diambil oleh ${payload.pemohon} dari ${barang.rak_nama}`],
    );
    await client.query(
      `INSERT INTO log_activity(user_id,aksi,modul,detail,ip)
       VALUES($1,'Pengambilan','Pengambilan Barang',$2,$3)`,
      [operatorId, `${noRef}: ${barang.nama} ${payload.qty} ${barang.satuan_nama || ''}; pengambil ${payload.pemohon}; QR ${barang.qr_code}`, ip],
    );
    await client.query('COMMIT');
    const [history] = await query(
      `SELECT ${historyFields}
       FROM pengambilan_barang p
       LEFT JOIN barang b ON b.id=p.barang_id
       LEFT JOIN rak r ON r.id=p.rak_id
       LEFT JOIN lokasi l ON l.id=r.lokasi_id
       LEFT JOIN users u ON u.id=p.operator_id
       WHERE p.id=$1`,
      [transaction.rows[0].id],
    ).then((result) => result.rows);
    return { transaction: history, stok_akhir: newStock };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function firstOperatorId() {
  if (useTestStore) return 1;
  const result = await query(`SELECT id FROM users WHERE status='Aktif' ORDER BY id LIMIT 1`);
  return result.rows[0]?.id || null;
}
