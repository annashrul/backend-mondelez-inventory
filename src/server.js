import cors from 'cors';
import { setSettingsSocket } from './services/settingsService.js';
import { sessionMiddleware } from './middleware/session.js';
import { verifyToken } from './services/authService.js';
import { validateSession } from './services/securityService.js';
import settingsRoutes from './routes/settingsRoutes.js';
import { startBackupScheduler } from './services/backupService.js';
import { apiLogger } from './middleware/apiLogger.js';
import express from 'express';
import http from 'node:http';
import 'dotenv/config';
import { Server } from 'socket.io';
import barangRoutes from './routes/barangRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import { createMasterRouter } from './routes/masterRoutes.js';
import { aiRoutes, pengambilanRoutes, rackScanRoutes } from './routes/pengambilanRoutes.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRoutes, levelRoutes, userRoutes } from './routes/accessRoutes.js';
import logActivityRoutes from './routes/logActivityRoutes.js';
import { adjustmentRoutes, kartuStokRoutes } from './routes/stockRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import { setNotificationSocket, userIdFromToken } from './services/notificationService.js';

const app = express();
const port = Number(process.env.PORT) || 5000;
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((origin) => origin.trim());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: origins },
});

io.use(async (socket, next) => {
  try {
  const userId = userIdFromToken(socket.handshake.auth?.token);
  if (!userId || !await validateSession(verifyToken(socket.handshake.auth?.token), false)) return next(new Error('Sesi tidak valid'));
  socket.data.userId = userId;
  socket.join(`user:${userId}`);
  return next();
  } catch { next(new Error('Sesi tidak valid')); }
});
setNotificationSocket(io);
setSettingsSocket(io);

app.disable('x-powered-by');
app.use(apiLogger);
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

app.get('/api/v1/health', (req, res) => res.json({ status: 'ok', service: 'inventory-backend' }));
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/barang', barangRoutes);
app.use('/api/v1/menus', menuRoutes);
app.use('/api/v1/pengambilan', pengambilanRoutes);
app.use('/api/v1/level-pengguna', levelRoutes);
app.use('/api/v1/pengguna', userRoutes);
app.use('/api/v1/log-activity', logActivityRoutes);
app.use('/api/v1/adjustment', adjustmentRoutes);
app.use('/api/v1/kartu-stok', kartuStokRoutes);
app.use('/api/v1/notifications', notificationRoutes);

for (const endpoint of ['kelompok-barang', 'satuan', 'lokasi', 'rak']) {
  app.use(`/api/v1/${endpoint}`, endpoint === 'rak' ? rackScanRoutes : createMasterRouter(endpoint));
  if (endpoint === 'rak') app.use(`/api/v1/${endpoint}`, createMasterRouter(endpoint));
}

app.use(notFound);
app.use(errorHandler);

const host = process.env.HOST || '127.0.0.1';

if (process.env.NODE_ENV !== 'test') {
  startBackupScheduler();
	server.listen(port, host, () => {
	  console.log(`Inventory API berjalan di http://${host}:${port}/api/v1`);
	});

}

export default app;
export { server, io };
