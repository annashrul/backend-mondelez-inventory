export function withdrawalHistoryLink(reference, env = process.env) {
  if (!reference) return null;
  const candidates = env.FRONTEND_URL
    ? [env.FRONTEND_URL]
    : (env.CORS_ORIGIN || 'http://localhost:5173').split(',');
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      url.pathname = '/pengambilan-barang';
      url.search = '';
      url.hash = '';
      url.searchParams.set('tab', 'riwayat');
      url.searchParams.set('search', String(reference));
      return url.href;
    } catch { /* Ignore wildcard CORS entries and invalid URL configuration. */ }
  }
  return null;
}
