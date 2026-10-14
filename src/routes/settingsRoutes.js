import { Router } from 'express';
import { query } from '../config/database.js';
import { getSettings, saveSettings } from '../services/settingsService.js';
import { settingsAccess } from '../middleware/settingsAccess.js';
import { smtpConfig, recipientEmails } from '../services/emailService.js';
import { findUsers } from '../repositories/accessRepository.js';
import { HttpError } from '../middleware/errors.js';
import { getBackupStatus, runBackup } from '../services/backupService.js';

const router = Router();
router.get('/runtime', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { tema, bahasa, items_per_page, nama_perusahaan, alamat, telepon, email, session_timeout } = settings;
    res.json({ tema, bahasa, items_per_page, nama_perusahaan, alamat, telepon, email, session_timeout });
  } catch (error) { next(error); }
});
router.get('/', settingsAccess(), async (req, res, next) => {
  try { res.json(await getSettings({ fresh: true })); } catch (error) { next(error); }
});
router.get('/database-status', settingsAccess(), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV !== 'test') await query('SELECT 1');
    res.json({ connected: true, ...(await getBackupStatus()) });
  } catch { res.json({ connected: false, backup: null }); }
});
router.post('/backup', settingsAccess('pengaturan.update'), async (req, res, next) => {
  try { res.json(await runBackup()); } catch (error) { next(error); }
});
router.put('/:section', settingsAccess('pengaturan.update'), async (req, res, next) => {
  try {
    if (req.body?.auto_backup === true && !(await getBackupStatus()).backup_available) throw new HttpError(422, 'pg_dump belum tersedia di server. Pasang PostgreSQL client sebelum mengaktifkan backup.');
    if (req.body?.two_factor === true) {
      try { smtpConfig(); } catch { throw new HttpError(422, 'Konfigurasi email harus lengkap sebelum mengaktifkan verifikasi login'); }
      const admins = (await findUsers()).filter(user => String(user.level_detail?.nama).toLowerCase() === 'admin' && user.status === 'Aktif');
      if (!admins.length || admins.some(user => !recipientEmails([user]).length)) throw new HttpError(422, 'Isi email semua admin aktif sebelum mengaktifkan verifikasi login');
    }
    res.json(await saveSettings(req.params.section, req.body));
  } catch (error) { next(error); }
});
export default router;
