import { findAll } from '../repositories/menuRepository.js';

export async function listMenus(req, res, next) {
  try {
    res.json(await findAll());
  } catch (error) {
    next(error);
  }
}