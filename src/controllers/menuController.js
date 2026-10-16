import { toPublicMenu } from '../config/menuColumns.js';
import { findAll } from '../repositories/menuRepository.js';

export async function listMenus(req, res, next) {
  try {
    res.json((await findAll()).map(toPublicMenu));
  } catch (error) {
    next(error);
  }
}