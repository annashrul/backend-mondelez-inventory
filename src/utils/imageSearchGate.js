// Gating & skor untuk pencarian barang by gambar (k-NN pgvector).
//
// MASALAH yang diselesaikan file ini:
//   Cosine similarity SigLIP TIDAK terkalibrasi sebagai probabilitas. Pasangan
//   gambar yang sama sekali tidak berhubungan pun bisa bernilai 0.5-0.85, jadi
//   angka mentah `1 - (embedding <=> query)` tidak boleh dibaca sebagai
//   "kemiripan 82%". Selain itu query k-NN tanpa ambang selalu mengembalikan
//   `LIMIT` tetangga terdekat apa pun jaraknya, sehingga barang tak berhubungan
//   tetap ikut tampil.
//
// Solusinya dua gerbang berbasis JARAK (cosine distance, 0 = identik):
//   1. Absolut  : buang kandidat dengan jarak > IMAGE_SEARCH_ABS_MAX.
//   2. Relatif  : buang kandidat yang terlalu jauh dibanding kandidat terbaik
//                 (jarak > jarak_terbaik * (1 + IMAGE_SEARCH_RATIO_MAX)).
// Kandidat yang lolos diberi skor 0..1 yang linear terhadap ambang:
//   jarak <= ABS_FLOOR  -> 1.0 (match kuat)
//   jarak >= ABS_MAX    -> 0.0 (batas ditolak)
//
// ENV (semua opsional, ada default):
//   IMAGE_SEARCH_ABS_MAX    0.45  jarak maksimum yang masih lolos gerbang absolut
//   IMAGE_SEARCH_ABS_FLOOR  0.18  jarak yang dianggap match kuat -> skor 1
//   IMAGE_SEARCH_RATIO_MAX  0.60  toleransi relatif terhadap kandidat terbaik
//   IMAGE_SEARCH_LIMIT      12    ukuran pool kandidat yang diambil dari DB
//   IMAGE_SEARCH_NEAR_LIMIT 6     jumlah maksimum hasil yang dikembalikan
//
// CATATAN: SigLIP mengubah similarity jadi probabilitas lewat
// `sigmoid(logit_scale * cos + logit_bias)`, TAPI konstanta itu dilatih untuk
// pasangan gambar<->teks, bukan gambar<->gambar. Jadi menerapkannya di sini
// tidak sah; skor di bawah adalah normalisasi jarak yang eksplisit, bukan
// probabilitas model.

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function imageSearchConfig() {
  const absMax = toNumber(process.env.IMAGE_SEARCH_ABS_MAX, 0.45);
  const absFloor = toNumber(process.env.IMAGE_SEARCH_ABS_FLOOR, 0.18);
  return {
    absMax,
    // Jangan biarkan floor >= max, jika tidak pembagian skor jadi nol/negatif.
    absFloor: absFloor >= absMax ? absMax * 0.4 : absFloor,
    ratioMax: Math.max(0, toNumber(process.env.IMAGE_SEARCH_RATIO_MAX, 0.6)),
    pool: toPositiveInt(process.env.IMAGE_SEARCH_LIMIT, 12),
    nearLimit: toPositiveInt(process.env.IMAGE_SEARCH_NEAR_LIMIT, 6),
  };
}

export function scoreFromDistance(distance, config) {
  if (!Number.isFinite(distance)) return 0;
  const { absMax, absFloor } = config;
  const span = absMax - absFloor;
  if (span <= 0) return distance <= absMax ? 1 : 0;
  const score = (absMax - distance) / span;
  return Math.max(0, Math.min(1, score));
}

// rows: hasil k-NN dengan field numeric `distance`. Mengembalikan salinan yang
// sudah disaring + diberi `confidence`, sudah terurut dari paling mirip.
export function applyImageSearchGate(rows, requestedLimit) {
  const config = imageSearchConfig();
  const candidates = rows
    .map((row) => ({ row, distance: Number(row.distance) }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((a, b) => a.distance - b.distance);

  if (!candidates.length) return [];

  const best = candidates[0].distance;
  // Gerbang relatif: kandidat tidak boleh jauh lebih buruk dari yang terbaik.
  const relativeCeiling = best <= 0 ? config.absMax : best * (1 + config.ratioMax);

  const limit = Math.min(
    toPositiveInt(requestedLimit, config.nearLimit),
    config.nearLimit,
  );

  return candidates
    .filter((item) => item.distance <= config.absMax && item.distance <= relativeCeiling)
    .slice(0, limit)
    .map(({ row, distance }) => ({
      ...row,
      distance,
      confidence: scoreFromDistance(distance, config),
    }));
}
