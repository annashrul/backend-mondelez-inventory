import { HttpError } from '../middleware/errors.js';
import { verifyToken } from '../services/authService.js';
import { findUser } from '../repositories/accessRepository.js';
import { recipientEmails, sendTestEmail } from '../services/emailService.js';

export function createTestEmailHandler({ verify = verifyToken, getUser = findUser, send = sendTestEmail, now = Date.now } = {}) {
  const attempts = new Map();
  return async (req, res, next) => {
    try {
      let payload;
      try { payload = verify(req.headers.authorization?.replace(/^Bearer\s+/i, '')); } catch { payload = null; }
      if (!payload?.sub) throw new HttpError(401, 'Silakan login untuk mengirim email uji');
      const user = await getUser(payload.sub);
      if (!user || user.status !== 'Aktif') throw new HttpError(403, 'Akun tidak aktif');
      if (!user.permissions?.some(permission => ['*', 'pengaturan.read', 'pengaturan.update'].includes(permission))) {
        throw new HttpError(403, 'Tidak memiliki akses pengaturan');
      }
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (email.length > 254 || recipientEmails([{ email }]).length !== 1) throw new HttpError(422, 'Masukkan satu alamat email yang valid');
      const key = String(user.id);
      const timestamp = now();
      if (attempts.has(key) && timestamp - attempts.get(key) < 60000) throw new HttpError(429, 'Tunggu satu menit sebelum mengirim email uji lagi');
      for (const [id, started] of attempts) if (timestamp - started >= 60000) attempts.delete(id);
      attempts.set(key, timestamp);
      try {
        const result = await send(email);
        if (!result.sent) throw Object.assign(new Error('Email ditolak SMTP'), { code: 'SMTP_REJECTED' });
        res.json({ sent: true, message: 'Email uji diterima server SMTP. Periksa inbox atau spam.' });
      } catch (error) {
        const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SMTP_ERROR';
        console.error(JSON.stringify({ event: 'test_email', status: 'failed', code }));
        throw new HttpError(error.code === 'SMTP_CONFIG' ? 503 : 502,
          error.code === 'SMTP_CONFIG' ? 'Konfigurasi email server belum lengkap' : 'Gagal mengirim email uji. Periksa konfigurasi email server.');
      }
    } catch (error) { next(error); }
  };
}

export const testEmail = createTestEmailHandler();
