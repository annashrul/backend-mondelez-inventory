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
    res.json(await saveNotificationSetting(req.body || {}));
  } catch (error) {
    next(error);
  }
}
