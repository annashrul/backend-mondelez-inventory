import { Router } from 'express';
import { settingsAccess } from '../middleware/settingsAccess.js';
import { HttpError } from '../middleware/errors.js';
import { feedbackSearch, listSearchAudit, searchMethods } from '../services/searchAuditService.js';
const router = Router();
router.get('/', settingsAccess('log.read'), async (req,res,next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now()-30*86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to) throw new HttpError(422,'Rentang audit tidak valid');
    const method = String(req.query.method || ''), status = String(req.query.status || '');
    if (method && !searchMethods.includes(method) || status && !['found','not_found','error'].includes(status)) throw new HttpError(422,'Filter audit tidak valid');
    const page = Math.max(1,parseInt(req.query.page,10)||1), limit = Math.min(100,Math.max(1,parseInt(req.query.limit,10)||20));
    const result = await listSearchAudit({ from: from.toISOString(), to: to.toISOString(), method, status, limit, offset: (page-1)*limit });
    res.json({ ...result, pagination: { page,limit,total:result.total,total_pages:Math.max(1,Math.ceil(result.total/limit)) } });
  } catch (error) { next(error); }
});
router.patch('/:id/feedback', settingsAccess('pengambilan.read'), async (req,res,next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw new HttpError(422,'ID audit tidak valid');
    await feedbackSearch(req.params.id, Number(req.settingsUser.id), req.body || {});
    res.json({ recorded: true });
  } catch (error) { next(error); }
});
export default router;
