import { verifyToken } from '../services/authService.js';
import { validateSession } from '../services/securityService.js';
import { HttpError } from './errors.js';
export async function sessionMiddleware(req,res,next) {
  if (req.path === '/api/v1/settings/runtime' || req.path.startsWith('/api/v1/auth/') || !req.headers.authorization) return next();
  try {
    let payload;
    try { payload=verifyToken(req.headers.authorization.replace(/^Bearer\s+/i,'')); } catch { payload=null; }
    if (!payload || !await validateSession(payload)) throw new HttpError(401,'Sesi berakhir, silakan login kembali');
    next();
  } catch(error) { next(error); }
}
