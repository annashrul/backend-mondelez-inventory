import { HttpError } from '../middleware/errors.js';

export function notificationPagination(query = {}) {
  const requested = Number(query.limit ?? 10);
  if (!Number.isSafeInteger(requested) || requested < 1) throw new HttpError(422, 'Limit notifikasi tidak valid');
  const limit = Math.min(requested, 100);
  const cursor = query.cursor == null ? null : String(query.cursor);
  if (cursor !== null && (!/^[1-9][0-9]{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n)) {
    throw new HttpError(422, 'Cursor notifikasi tidak valid');
  }
  return { limit, cursor };
}

export function notificationPage(rows, unread, limit) {
  const hasNext = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    rows: page,
    unread,
    pagination: { limit, has_next: hasNext, next_cursor: hasNext ? String(page.at(-1).id) : null },
  };
}
