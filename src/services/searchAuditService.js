import { query } from '../config/database.js';
import { readStore, updateStore } from '../config/store.js';
import { HttpError } from '../middleware/errors.js';
const testStore = process.env.NODE_ENV === 'test';
export const searchMethods = ['camera', 'gallery', 'voice', 'text', 'rack'];

export async function recordSearch(entry) {
  if (testStore) return updateStore(store => { (store.search_audit ||= []).push(entry); });
  const keys = ['id','created_at','user_id','method','query_text','status','http_status','duration_ms','result_count','returned_count','results','model','error_code'];
  await query(`INSERT INTO search_audit (${keys.join(',')}) VALUES (${keys.map((key, i) => '$' + (i + 1)).join(',')})`, keys.map(key => key === 'results' ? JSON.stringify(entry[key]) : entry[key]));
}

export async function feedbackSearch(id, userId, { verdict, item_id }) {
  if (!['selected','correct','incorrect'].includes(verdict)) throw new HttpError(422, 'Penilaian pencarian tidak valid');
  const itemId = item_id === undefined || item_id === null ? null : Number(item_id);
  if (itemId !== null && (!Number.isSafeInteger(itemId) || itemId < 1)) throw new HttpError(422, 'Barang penilaian tidak valid');
  const apply = row => {
    if (!row || Number(row.user_id) !== userId) throw new HttpError(404, 'Audit pencarian tidak ditemukan');
    if (row.status === 'error') throw new HttpError(422, 'Error sistem tidak dapat dinilai sebagai akurasi pencarian');
    const rank = itemId === null ? -1 : row.results.findIndex(item => Number(item.id) === itemId);
    if ((verdict !== 'incorrect' && rank < 0) || (itemId !== null && rank < 0)) throw new HttpError(422, 'Barang harus berasal dari hasil pencarian');
    if (verdict === 'selected') {
      if (Number(row.selected_item_id) !== itemId) { row.relevance = null; row.reviewed_at = null; }
    } else {
      row.relevance = verdict === 'correct';
      row.reviewed_at = new Date().toISOString();
    }
    row.selected_item_id = itemId;
    row.selected_rank = rank < 0 ? null : rank + 1;
    return row;
  };
  if (testStore) return updateStore(store => apply((store.search_audit || []).find(row => row.id === id)));
  // One row lock prevents overlapping feedback requests from losing updates.
  const { pool } = await import('../config/database.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = apply((await client.query('SELECT * FROM search_audit WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId])).rows[0]);
    await client.query('UPDATE search_audit SET selected_item_id=$2, selected_rank=$3, relevance=$4, reviewed_at=$5 WHERE id=$1', [id,row.selected_item_id,row.selected_rank,row.relevance,row.reviewed_at]);
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function summarizeSearches(rows) {
  return searchMethods.map(method => {
    const group = rows.filter(row => row.method === method);
    return metrics({ method, total: group.length,
      found: group.filter(row => row.status === 'found').length,
      not_found: group.filter(row => row.status === 'not_found').length,
      errors: group.filter(row => row.status === 'error').length,
      reviewed: group.filter(row => row.relevance !== null && row.relevance !== undefined).length,
      relevant: group.filter(row => row.relevance === true).length,
      selected: group.filter(row => row.selected_item_id != null).length,
      avg_duration_ms: group.length ? group.reduce((sum,row) => sum + row.duration_ms,0) / group.length : null,
    });
  });
}
function metrics(row) {
  const result = { ...row };
  for (const key of ['total','found','not_found','errors','reviewed','relevant','selected']) result[key] = Number(row[key]);
  const percent = (count, total) => total ? Math.round(count / total * 10000) / 100 : null;
  result.not_found_rate = percent(result.not_found, result.found + result.not_found);
  result.error_rate = percent(result.errors, result.total);
  result.accuracy_reviewed = percent(result.relevant, result.reviewed);
  result.review_coverage = percent(result.reviewed, result.total);
  result.avg_duration_ms = row.avg_duration_ms == null ? null : Math.round(Number(row.avg_duration_ms));
  return result;
}
export async function listSearchAudit({ from, to, method, status, limit, offset }) {
  const matches = row => row.created_at >= from && row.created_at < to && (!method || row.method === method) && (!status || row.status === status);
  if (testStore) {
    const rows = (await readStore()).search_audit?.filter(matches).sort((a,b) => b.created_at.localeCompare(a.created_at)) || [];
    return { data: rows.slice(offset, offset + limit), total: rows.length, summary: summarizeSearches(rows) };
  }
  const where = `created_at >= $1 AND created_at < $2 AND ($3='' OR method=$3) AND ($4='' OR status=$4)`;
  const args = [from,to,method,status];
  const rows = await query(`SELECT * FROM search_audit WHERE ${where} ORDER BY created_at DESC,id LIMIT $5 OFFSET $6`, [...args,limit,offset]);
  const totals = await query(`SELECT method, count(*)::int AS total,
    count(*) FILTER (WHERE status='found')::int AS found,
    count(*) FILTER (WHERE status='not_found')::int AS not_found,
    count(*) FILTER (WHERE status='error')::int AS errors,
    count(relevance)::int AS reviewed, count(*) FILTER (WHERE relevance IS TRUE)::int AS relevant,
    count(selected_item_id)::int AS selected, avg(duration_ms) AS avg_duration_ms
    FROM search_audit WHERE ${where} GROUP BY method`, args);
  const summary = searchMethods.map(method => {
    const row = totals.rows.find(row => row.method === method);
    return row ? metrics(row) : summarizeSearches([]).find(row => row.method === method);
  });
  return { data: rows.rows, total: summary.reduce((sum,row) => sum + row.total,0), summary };
}
