import { listActivities } from '../services/activityLogger.js';
import { paginated } from '../utils/pagination.js';

export async function listLogActivities(req, res, next) {
  try {
    res.json(paginated(await listActivities(String(req.query.search || '')), req.query));
  } catch (error) {
    next(error);
  }
}
