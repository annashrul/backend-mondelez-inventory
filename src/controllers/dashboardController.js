import { HttpError } from '../middleware/errors.js';
import { getDashboardStats } from '../repositories/dashboardRepository.js';

export async function stats(req, res, next) {
  try {
    const days = Number(req.query.days ?? 30);
    if (![7, 30, 90].includes(days)) throw new HttpError(422, 'Periode dashboard tidak valid');
    res.json(await getDashboardStats({ days }));
  } catch (error) {
    next(error);
  }
}
