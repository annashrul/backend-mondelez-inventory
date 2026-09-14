import { Router } from 'express';
import * as controller from '../controllers/masterController.js';

export function createMasterRouter(key) {
  const router = Router();
  router.get('/', controller.list(key));
  router.get('/:id', controller.get(key));
  router.post('/', controller.create(key));
  router.put('/:id', controller.update(key));
  router.delete('/:id', controller.remove(key));
  return router;
}