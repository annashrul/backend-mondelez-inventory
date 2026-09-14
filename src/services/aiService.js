import { HttpError } from '../middleware/errors.js';

export async function embedImage(file) {
  if (process.env.NODE_ENV === 'test') return { embedding: Array(768).fill(0), model: 'test-model', dim: 768 };
  const baseUrl = process.env.AI_SERVICE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new HttpError(503, 'AI_SERVICE_URL belum dikonfigurasi');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AI_SERVICE_TIMEOUT_MS) || 60000);
  try {
    const response = await fetch(`${baseUrl}/embed`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(process.env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${process.env.AI_SERVICE_TOKEN}` } : {}) },
      body: JSON.stringify({ images: [`data:${file.mimetype};base64,${file.buffer.toString('base64')}`] })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
    if (result.failed?.length || !Array.isArray(result.vectors?.[0])) throw new Error(result.failed?.[0]?.reason || 'AI tidak menghasilkan embedding');
    const expected = Number(process.env.VECTOR_DIMENSION) || 768;
    if (result.dim !== expected || result.vectors[0].length !== expected) throw new Error(`Dimensi embedding ${result.dim} tidak sesuai ${expected}`);
    return { embedding: result.vectors[0], model: result.model, dim: result.dim };
  } catch (error) {
    throw new HttpError(502, `Gagal membuat embedding gambar: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  } finally {
    clearTimeout(timer);
  }
}