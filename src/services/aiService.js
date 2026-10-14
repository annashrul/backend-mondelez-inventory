import { HttpError } from '../middleware/errors.js';

const RETRYABLE_STATUS = new Set([502, 503, 504, 499, 520, 521, 522, 524, 525]);
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 30000;

function isRetryable(error, attempt) {
  if (attempt >= DEFAULT_MAX_ATTEMPTS) return false;
  if (error?.name === 'AbortError') return true;
  if (error?.cause?.code === 'ETIMEDOUT' || error?.cause?.code === 'ECONNRESET' || error?.cause?.code === 'ECONNREFUSED') return true;
  const m = /HTTP\s*(\d{3})/.exec(error?.message || '');
  if (m && RETRYABLE_STATUS.has(Number(m[1]))) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestImageEmbeddingOnce(image, attempt, totalTimeoutLeftMs) {
  const baseUrl = process.env.AI_SERVICE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new HttpError(503, 'AI_SERVICE_URL belum dikonfigurasi');
  const perAttemptTimeoutMs = Math.max(15000, Math.min(totalTimeoutLeftMs, Number(process.env.AI_SERVICE_TIMEOUT_MS) || 60000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), perAttemptTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}/embed`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(process.env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${process.env.AI_SERVICE_TOKEN}` } : {}) },
      body: JSON.stringify({ images: [image] })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
    if (result.failed?.length || !Array.isArray(result.vectors?.[0])) throw new Error(result.failed?.[0]?.reason || 'AI tidak menghasilkan embedding');
    const expected = Number(process.env.VECTOR_DIMENSION) || 768;
    if (result.dim !== expected || result.vectors[0].length !== expected) throw new Error(`Dimensi embedding ${result.dim} tidak sesuai ${expected}`);
    return { embedding: result.vectors[0], model: result.model, dim: result.dim };
  } finally {
    clearTimeout(timer);
  }
}

async function requestImageEmbedding(image) {
  if (process.env.NODE_ENV === 'test') return { embedding: Array(768).fill(0), model: 'test-model', dim: 768 };
  const totalDeadlineMs = Number(process.env.AI_SERVICE_TIMEOUT_MS) || 120000;
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(5000, totalDeadlineMs - elapsed);
    try {
      return await requestImageEmbeddingOnce(image, attempt, remaining);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error, attempt)) break;
      const elapsedNow = Date.now() - startedAt;
      if (elapsedNow + DEFAULT_RETRY_DELAY_MS + 5000 > totalDeadlineMs) break;
      await sleep(DEFAULT_RETRY_DELAY_MS);
    }
  }

  const errMsg = lastError?.name === 'AbortError' ? 'timeout' : (lastError?.message || 'unknown error');
  throw new HttpError(502, `Gagal membuat embedding gambar: ${errMsg}${DEFAULT_MAX_ATTEMPTS > 1 ? ` (${DEFAULT_MAX_ATTEMPTS}x percobaan)` : ''}`);
}

export async function embedImage(file) {
  return requestImageEmbedding(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
}

export async function embedImageSource(image) {
  if (typeof image !== 'string' || !image.trim()) throw new HttpError(400, 'Foto barang wajib dikirim');
  return requestImageEmbedding(image.trim());
}
