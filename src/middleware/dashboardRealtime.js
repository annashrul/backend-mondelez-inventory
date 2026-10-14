const resources = new Set(['barang', 'pengambilan', 'adjustment', 'kartu-stok', 'kelompok-barang', 'satuan', 'lokasi', 'rak', 'pengguna']);
const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Emit only a refresh signal after a successful write. Dashboard data stays
// behind its normal authenticated API and is never broadcast to other users.
export function dashboardRealtime(io) {
  return (req, res, next) => {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const resource = path.split('/')[3];
    const readOnlyPost = resource === 'rak' && ['/api/v1/rak/scan', '/api/v1/rak/items'].includes(path);
    if (path.startsWith('/api/v1/') && resources.has(resource) && mutationMethods.has(req.method) && !readOnlyPost) {
      res.once('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) io.emit('dashboard:updated');
      });
    }
    next();
  };
}
