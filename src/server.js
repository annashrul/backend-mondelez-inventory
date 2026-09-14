import cors from 'cors';
import express from 'express';
import 'dotenv/config';
import barangRoutes from './routes/barangRoutes.js';
import { createMasterRouter } from './routes/masterRoutes.js';
import { errorHandler, notFound } from './middleware/errors.js';

const app = express();
const port = Number(process.env.PORT) || 5000;
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((origin) => origin.trim());

app.disable('x-powered-by');
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (req, res) => res.json({ status: 'ok', service: 'inventory-backend' }));
app.post('/api/v1/auth/login', (req, res) => {
  if (req.body?.username !== 'admin' || req.body?.password !== 'admin') {
    return res.status(401).json({ message: 'Username atau password salah' });
  }
  return res.json({
    user: { id: 1, username: 'admin', nama: 'Administrator', email: 'admin@company.com', level: 'Admin', status: 'Aktif' },
    token: 'local-development-token'
  });
});
app.use('/api/v1/barang', barangRoutes);

for (const endpoint of ['kelompok-barang', 'satuan', 'lokasi', 'rak']) {
  app.use(`/api/v1/${endpoint}`, createMasterRouter(endpoint));
}

app.use(notFound);
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`Inventory API berjalan di http://localhost:${port}/api/v1`));
}

export default app;