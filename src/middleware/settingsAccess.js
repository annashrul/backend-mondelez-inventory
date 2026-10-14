import { HttpError } from './errors.js';
import { verifyToken } from '../services/authService.js';
import { findUser } from '../repositories/accessRepository.js';

export function settingsAccess(permission = 'pengaturan.read') {
  return async (req, res, next) => {
    try {
      let payload;
      try { payload = verifyToken(req.headers.authorization?.replace(/^Bearer\s+/i, '')); } catch { payload = null; }
      if (!payload?.sub) throw new HttpError(401, 'Silakan login kembali');
      const user = await findUser(payload.sub);
      if (!user || user.status !== 'Aktif' || !user.permissions?.some(item => item === '*' || item === permission)) throw new HttpError(403, 'Tidak memiliki akses pengaturan');
      req.settingsUser = user; next();
    } catch (error) { next(error); }
  };
}
