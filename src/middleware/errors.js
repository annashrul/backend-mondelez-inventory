export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan` });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ message: 'Body JSON tidak valid' });
  }
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `Ukuran gambar maksimal ${process.env.IMAGE_MAX_SIZE_MB || 5} MB` });
  if (!error.status) console.error(error);
  return res.status(error.status || 500).json({
    message: error.status ? error.message : 'Terjadi kesalahan pada server',
    ...(error.details ? { errors: error.details } : {})
  });
}