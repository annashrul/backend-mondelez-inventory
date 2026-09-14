import { query } from "../config/database.js";
import { readStore, updateStore } from "../config/store.js";

const fields = `b.id, b.kode, b.barcode, b.nama,
  b.kelompok_id, b.satuan_id, b.rak_id,
  json_build_object('id',k.id,'kode',k.kode,'nama',k.nama) AS kelompok_detail,
  json_build_object('id',s.id,'kode',s.kode,'nama',s.nama) AS satuan_detail,
  json_build_object('id',r.id,'kode',r.kode,'nama',r.nama,'qr_code',r.qr_code,'lokasi_id',r.lokasi_id) AS rak_detail,
  b.stok, b.stok_min, b.harga, b.deskripsi, b.image_path, b.image_url,
  b.embedding_model, (b.embedding IS NOT NULL) AS has_embedding,
  COALESCE(b.is_deleted, FALSE) AS is_deleted, b.deleted_at, b.deleted_by,
  b.created_at, b.updated_at`;
const joins = `LEFT JOIN kelompok_barang k ON k.id=b.kelompok_id
  LEFT JOIN satuan s ON s.id=b.satuan_id LEFT JOIN rak r ON r.id=b.rak_id`;
const useTestStore = process.env.NODE_ENV === "test";

function hydrateMasterDetails(item, store) {
  const kelompok = store.kelompok_barang.find((row) => row.id === item.kelompok_id);
  const satuan = store.satuan.find((row) => row.id === item.satuan_id);
  const rak = store.rak.find((row) => row.id === item.rak_id);
  return {
    ...item,
    kelompok_detail: kelompok || null,
    satuan_detail: satuan || null,
    rak_detail: rak || null,
  };
}

function assertTestMasterReferences(item, store) {
  const valid = store.kelompok_barang.some((row) => row.id === item.kelompok_id)
    && store.satuan.some((row) => row.id === item.satuan_id && !row.is_deleted)
    && store.rak.some((row) => row.id === item.rak_id && !row.is_deleted)
    && store.kelompok_barang.some((row) => row.id === item.kelompok_id && !row.is_deleted);
  if (!valid) throw Object.assign(new Error("master reference missing"), { code: "INVALID_REFERENCE" });
}

export async function findAll(search = "") {
  const term = search.trim();
  if (useTestStore) {
    const store = await readStore();
    const items = store.barang.filter((item) => !item.is_deleted).map((item) => hydrateMasterDetails(item, store));
    return term
      ? items.filter((item) =>
          [item.kode, item.barcode, item.nama].some((value) =>
            value?.toLowerCase().includes(term.toLowerCase()),
          ),
        )
      : items;
  }
  const result = await query(
    `SELECT ${fields} FROM barang b ${joins}
     WHERE COALESCE(b.is_deleted, FALSE)=FALSE
       AND ($1 = '' OR b.kode ILIKE '%' || $1 || '%' OR b.barcode ILIKE '%' || $1 || '%' OR b.nama ILIKE '%' || $1 || '%')
     ORDER BY b.id`,
    [term],
  );
  return result.rows;
}

export async function findById(id) {
  if (useTestStore) {
    const store = await readStore();
    const item = store.barang.find((row) => row.id === id && !row.is_deleted);
    return item ? hydrateMasterDetails(item, store) : null;
  }
  const result = await query(
    `SELECT ${fields} FROM barang b ${joins} WHERE b.id = $1 AND COALESCE(b.is_deleted, FALSE)=FALSE`,
    [id],
  );
  return result.rows[0] || null;
}

export async function create(item, image = {}) {
  if (useTestStore)
    return updateStore((data) => {
      assertTestMasterReferences(item, data);
      if (
        data.barang.some(
          (row) => row.kode.toLowerCase() === item.kode.toLowerCase(),
        )
      )
        throw Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "barang_kode_key",
        });
      if (
        data.barang.some(
          (row) => row.barcode?.toLowerCase() === item.barcode.toLowerCase(),
        )
      )
        throw Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "barang_barcode_unique_idx",
        });
      const created = {
        id: Math.max(0, ...data.barang.map((row) => row.id)) + 1,
        ...item,
        image_path: image.path,
        image_url: image.url,
        embedding_model: image.model,
        has_embedding: Boolean(image.embedding),
      };
      data.barang.push(created);
      return hydrateMasterDetails(created, data);
    });
  const values = ["kode", "barcode", "nama", "kelompok_id", "satuan_id", "rak_id", "stok", "stok_min", "harga"].map((field) => item[field]);
  const result = await query(
    `INSERT INTO barang (kode, barcode, nama, kelompok_id, satuan_id, rak_id, stok, stok_min, harga, image_path, image_url, embedding, embedding_model)
     SELECT $1,$2,$3,k.id,s.id,r.id,$7,$8,$9,$10,$11,$12::extensions.vector,$13
     FROM kelompok_barang k, satuan s, rak r
     WHERE k.id=$4 AND s.id=$5 AND r.id=$6
       AND COALESCE(k.is_deleted, FALSE)=FALSE AND COALESCE(s.is_deleted, FALSE)=FALSE AND COALESCE(r.is_deleted, FALSE)=FALSE
     RETURNING id`,
    [
      ...values,
      image.path || null,
      image.url || null,
      image.embedding ? JSON.stringify(image.embedding) : null,
      image.model || null,
    ],
  );
  if (!result.rowCount)
    throw Object.assign(new Error("master reference missing"), {
      code: "INVALID_REFERENCE",
    });
  return findById(result.rows[0].id);
}

export async function update(id, item, image) {
  if (useTestStore)
    return updateStore((data) => {
      assertTestMasterReferences(item, data);
      const index = data.barang.findIndex((row) => row.id === id);
      if (
        data.barang.some(
          (row) =>
            row.id !== id && row.kode.toLowerCase() === item.kode.toLowerCase(),
        )
      )
        throw Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "barang_kode_key",
        });
      if (
        data.barang.some(
          (row) =>
            row.id !== id &&
            row.barcode?.toLowerCase() === item.barcode.toLowerCase(),
        )
      )
        throw Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "barang_barcode_unique_idx",
        });
      data.barang[index] = {
        ...data.barang[index],
        ...item,
        ...(image
          ? {
              image_path: image.path,
              image_url: image.url,
              embedding_model: image.model,
              has_embedding: true,
            }
          : {}),
      };
      return hydrateMasterDetails(data.barang[index], data);
    });
  const values = ["kode", "barcode", "nama", "kelompok_id", "satuan_id", "rak_id", "stok", "stok_min", "harga"].map((field) => item[field]);
  const result = image
    ? await query(
        `UPDATE barang b SET kode=$1, barcode=$2, nama=$3,
        kelompok_id=k.id, satuan_id=s.id, rak_id=r.id, stok=$7, stok_min=$8, harga=$9,
        image_path=$10, image_url=$11, embedding=$12::extensions.vector, embedding_model=$13
        FROM kelompok_barang k, satuan s, rak r
        WHERE b.id=$14 AND k.id=$4 AND s.id=$5 AND r.id=$6
          AND COALESCE(k.is_deleted, FALSE)=FALSE AND COALESCE(s.is_deleted, FALSE)=FALSE AND COALESCE(r.is_deleted, FALSE)=FALSE RETURNING b.id`,
        [
          ...values,
          image.path,
          image.url,
          JSON.stringify(image.embedding),
          image.model,
          id,
        ],
      )
    : await query(
        `UPDATE barang b SET kode=$1, barcode=$2, nama=$3,
        kelompok_id=k.id, satuan_id=s.id, rak_id=r.id, stok=$7, stok_min=$8, harga=$9
        FROM kelompok_barang k, satuan s, rak r
        WHERE b.id=$10 AND k.id=$4 AND s.id=$5 AND r.id=$6
          AND COALESCE(k.is_deleted, FALSE)=FALSE AND COALESCE(s.is_deleted, FALSE)=FALSE AND COALESCE(r.is_deleted, FALSE)=FALSE RETURNING b.id`,
        [...values, id],
      );
  if (!result.rowCount)
    throw Object.assign(new Error("master reference missing"), {
      code: "INVALID_REFERENCE",
    });
  return findById(result.rows[0].id);
}

export async function remove(id, deletedBy = null) {
  if (useTestStore)
    return updateStore((data) => {
      const index = data.barang.findIndex((row) => row.id === id && !row.is_deleted);
      if (index < 0) return false;
      data.barang[index] = { ...data.barang[index], is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: deletedBy };
      return true;
    });
  const result = await query(
    "UPDATE barang SET is_deleted=TRUE, deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND COALESCE(is_deleted,FALSE)=FALSE RETURNING id",
    [id, deletedBy],
  );
  return Boolean(result.rowCount);
}

export async function findLookup(table) {
  if (!["kelompok_barang", "satuan", "rak"].includes(table))
    throw new Error("Lookup tidak valid");
  if (useTestStore) return (await readStore())[table];
  return (await query(`SELECT * FROM ${table} ORDER BY id`)).rows;
}
