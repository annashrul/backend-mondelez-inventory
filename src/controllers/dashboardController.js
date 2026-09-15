import { getDashboardStats } from '../repositories/dashboardRepository.js';

export async function stats(req, res, next) {
  try {
    res.json(await getDashboardStats());
  } catch (error) {
    next(error);
  }
}
