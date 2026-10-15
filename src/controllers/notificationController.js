import { safeLogActivity } from '../services/activityLogger.js';
import { settingsChanges } from '../utils/activityDetails.js';
import { HttpError } from '../middleware/errors.js';
import {
  getNotificationSetting,
  listNotifications,
  markNotificationsRead,
  saveNotificationSetting,
} from '../services/notificationService.js';

export async function listUserNotifications(req, res, next) {
  try {
    res.json(await listNotifications(req));
  } catch (error) {
    next(error);
  }
}

export async function readNotification(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(422, 'ID notifikasi tidak valid');
    res.json({ updated: await markNotificationsRead(req, id) });
  } catch (error) {
    next(error);
  }
}

export async function readAllNotifications(req, res, next) {
  try {
    res.json({ updated: await markNotificationsRead(req) });
  } catch (error) {
    next(error);
  }
}

export async function getSettings(req, res, next) {
  try {
    res.json(await getNotificationSetting());
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const before = await getNotificationSetting();
    const result = await saveNotificationSetting(req.body || {});
    await safeLogActivity({ req, aksi: 'Edit', modul: 'Pengaturan Notifikasi', detail: settingsChanges(before, result, ['email_enabled', 'stock_enabled', 'transaction_enabled', 'level_ids', 'user_ids']) });
    res.json(result);
  } catch (error) {
    next(error);
  }
}
