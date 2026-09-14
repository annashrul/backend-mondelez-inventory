import { Router } from 'express';
import * as controller from '../controllers/accessController.js';

export const levelRoutes=Router();
levelRoutes.get('/',controller.listLevels); levelRoutes.get('/:id',controller.getLevel); levelRoutes.post('/',controller.createLevel); levelRoutes.put('/:id',controller.updateLevel); levelRoutes.delete('/:id',controller.deleteLevel);
export const userRoutes=Router();
userRoutes.get('/',controller.listUsers); userRoutes.get('/:id',controller.getUser); userRoutes.post('/',controller.createUser); userRoutes.put('/:id',controller.updateUser); userRoutes.delete('/:id',controller.deleteUser);
export const authRoutes=Router(); authRoutes.post('/login',controller.login);