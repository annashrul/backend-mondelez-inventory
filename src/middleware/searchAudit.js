import { randomUUID } from 'node:crypto';
import { recordSearch } from '../services/searchAuditService.js';
import { requestUserId } from '../services/activityLogger.js';
export function searchContext(req) {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/api/v1/barang' && ['voice','text'].includes(req.query?.search_method)) return { method: req.query.search_method, query_text: String(req.query.search || '').slice(0,200) };
  if (req.method === 'POST' && path === '/api/v1/ai/search-image') return { method: req.body?.search_method === 'gallery' ? 'gallery' : 'camera', query_text: null };
  if (req.method === 'POST' && path === '/api/v1/rak/items') return { method: 'rack', query_text: String(req.body?.qr_code || '').slice(0,200) };
  return null;
}
export function searchAudit({ record = recordSearch } = {}) {
  return (req,res,next) => {
    const context = searchContext(req);
    if (!context) return next();
    const started = performance.now();
    const id = randomUUID();
    const json = res.json;
    let claimed = false;
    const save = async (body, statusCode) => {
      const results = body?.results || (context.method === 'rack' ? body?.barang : body?.data) || [];
      const rows = Array.isArray(results) ? results : [];
      const noCatalog = statusCode === 404 && ['camera','gallery'].includes(context.method);
      const status = statusCode >= 400 && !noCatalog ? 'error' : rows.length ? 'found' : 'not_found';
      const score = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
      await record({ id, created_at: new Date().toISOString(), user_id: requestUserId(req), ...context,
        status, http_status: statusCode, duration_ms: Math.max(0,Math.round(performance.now()-started)),
        result_count: status === 'error' ? 0 : Number(body?.pagination?.total ?? rows.length), returned_count: rows.length,
        results: rows.slice(0,100).map((row,index) => ({ id: row.id, nama: row.nama, kode: row.kode, rank: index+1,
          text_similarity: score(row.text_similarity), confidence: score(row.confidence), distance: score(row.distance) })),
        model: typeof body?.model === 'string' ? body.model : null,
        error_code: noCatalog ? 'NO_COMPATIBLE_EMBEDDINGS' : status === 'error' ? `HTTP_${statusCode}` : null,
        selected_item_id: null, selected_rank: null, relevance: null, reviewed_at: null,
      });
    };
    const failed = error => console.error(JSON.stringify({ event: 'search_audit_write_failed', code: /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'AUDIT_ERROR' }));
    res.json = function(body) {
      if (claimed) return json.call(this,body);
      claimed = true;
      Promise.resolve().then(() => save(body,res.statusCode)).then(() => {
        if (!res.destroyed && !res.writableEnded) json.call(res,{ ...body, search_audit_id: id });
      }, error => { failed(error); if (!res.destroyed && !res.writableEnded) json.call(res,body); }).catch(next);
      return this;
    };
    res.once('close', () => { if (!claimed) { claimed = true; void save(null,499).catch(failed); } });
    next();
  };
}
