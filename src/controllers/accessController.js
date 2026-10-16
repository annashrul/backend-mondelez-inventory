import { fromPublicLevel, toPublicLevel } from '../config/masterColumns.js';
import { getSettings } from '../services/settingsService.js';
import { beginLoginChallenge, consumeLoginChallenge, createSession, removeSession, validateSession } from '../services/securityService.js';
import { verifyToken } from '../services/authService.js';
import { HttpError } from '../middleware/errors.js';
import * as repository from '../repositories/accessRepository.js';
import { createToken, hashPassword, verifyPassword } from '../services/authService.js';
import { safeLogActivity } from '../services/activityLogger.js';
import { paginated } from '../utils/pagination.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
function id(value, label) { const parsed=Number(value); if(!Number.isSafeInteger(parsed)||parsed<1) throw new HttpError(422,`${label} tidak valid`); return parsed; }
function mapError(error) {
  if(error.code==='23505') throw new HttpError(409,'Kode level atau username sudah digunakan');
  if(error.code==='INVALID_ACTIONS') throw new HttpError(422,'Terdapat action ID yang tidak ditemukan atau tidak aktif');
  if(error.code==='INVALID_LEVEL') throw new HttpError(422,'Level pengguna tidak ditemukan'); throw error;
}
function levelPayload(body,current={}) {
  body = fromPublicLevel(body);
  const value={kode:text(body.kode??current.kode),nama:text(body.nama??current.nama),deskripsi:text(body.deskripsi??current.deskripsi),action_ids:body.action_ids??current.action_ids??[]};
  if(!value.kode||!value.nama) throw new HttpError(422,'Kode dan nama level wajib diisi');
  if(value.kode.length>20||value.nama.length>100) throw new HttpError(422,'Kode maksimal 20 dan nama maksimal 100 karakter');
  if(!Array.isArray(value.action_ids)) throw new HttpError(422,'action_ids harus berupa array');
  value.action_ids=value.action_ids.map((x)=>id(x,'Action ID')); return value;
}
async function userPayload(body,current={}) {
  const value={username:text(body.username??current.username),nama:text(body.nama??current.nama),email:text(body.email??current.email),level_id:id(body.level_id??current.level_id,'Level ID'),status:text(body.status??current.status)||'Aktif'};
  if(!value.username||!value.nama) throw new HttpError(422,'Username dan nama lengkap wajib diisi');
  if(!/^[a-zA-Z0-9._-]{3,50}$/.test(value.username)) throw new HttpError(422,'Username harus 3-50 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau strip');
  if(value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw new HttpError(422,'Format email tidak valid');
  if(!['Aktif','Nonaktif'].includes(value.status)) throw new HttpError(422,'Status harus Aktif atau Nonaktif');
  const password=text(body.password); if(!current.id&&!password) throw new HttpError(422,'Password wajib diisi');
  if(password&&password.length<8) throw new HttpError(422,'Password minimal 8 karakter');
  const settings = await getSettings();
  if (settings.two_factor && value.status === 'Aktif' && String((await repository.findLevel(value.level_id))?.nama).toLowerCase() === 'admin' && !value.email) throw new HttpError(422,'Email wajib diisi untuk admin dengan verifikasi login aktif');
  value.password=password?await hashPassword(password):null; return value;
}

export const listLevels=async(req,res,next)=>{try{res.json(paginated((await repository.findLevels(String(req.query.search||''))).map(toPublicLevel),req.query));}catch(e){next(e);}};
export const generateLevelCode=async(req,res,next)=>{try{res.json({code:await repository.generateLevelCode()});}catch(e){next(e);}};
export const getLevel=async(req,res,next)=>{try{const row=await repository.findLevel(id(req.params.id,'Level ID'));if(!row)throw new HttpError(404,'Level tidak ditemukan');res.json(toPublicLevel(row));}catch(e){next(e);}};
export const createLevel=async(req,res,next)=>{try{const row=await repository.saveLevel(null,levelPayload(req.body));await safeLogActivity({req,action:'Tambah',module:'Level Pengguna',detail:`Tambah level: ${row.nama||row.kode}`});res.status(201).json(toPublicLevel(row));}catch(e){try{mapError(e);}catch(x){next(x);}}};
export const updateLevel=async(req,res,next)=>{try{const key=id(req.params.id,'Level ID'),current=await repository.findLevel(key);if(!current)throw new HttpError(404,'Level tidak ditemukan');const row=await repository.saveLevel(key,levelPayload(req.body,current));await safeLogActivity({req,action:'Edit',module:'Level Pengguna',detail:`Edit level: ${row.nama||row.kode}`});res.json(toPublicLevel(row));}catch(e){try{mapError(e);}catch(x){next(x);}}};
export const deleteLevel=async(req,res,next)=>{try{const key=id(req.params.id,'Level ID'),current=await repository.findLevel(key),result=await repository.removeLevel(key);if(result==='missing')throw new HttpError(404,'Level tidak ditemukan');if(result==='used')throw new HttpError(409,'Level masih digunakan pengguna dan tidak dapat dihapus');await safeLogActivity({req,action:'Hapus',module:'Level Pengguna',detail:`Hapus level: ${current?.nama||current?.kode||key}`});res.json({message:'Level berhasil dihapus'});}catch(e){next(e);}};
export const listUsers=async(req,res,next)=>{try{res.json(paginated(await repository.findUsers(String(req.query.search||'')),req.query));}catch(e){next(e);}};
export const getUser=async(req,res,next)=>{try{const row=await repository.findUser(id(req.params.id,'User ID'));if(!row)throw new HttpError(404,'Pengguna tidak ditemukan');res.json(row);}catch(e){next(e);}};
export const createUser=async(req,res,next)=>{try{const row=await repository.saveUser(null,await userPayload(req.body));await safeLogActivity({req,action:'Tambah',module:'Master Pengguna',detail:`Tambah pengguna: ${row.nama||row.username}`});res.status(201).json(row);}catch(e){try{mapError(e);}catch(x){next(x);}}};
export const updateUser=async(req,res,next)=>{try{const key=id(req.params.id,'User ID'),current=await repository.findUser(key);if(!current)throw new HttpError(404,'Pengguna tidak ditemukan');const row=await repository.saveUser(key,await userPayload(req.body,current));await safeLogActivity({req,action:'Edit',module:'Master Pengguna',detail:`Edit pengguna: ${row.nama||row.username}`});res.json(row);}catch(e){try{mapError(e);}catch(x){next(x);}}};
export const deleteUser=async(req,res,next)=>{try{const key=id(req.params.id,'User ID'),current=await repository.findUser(key);if(!await repository.removeUser(key))throw new HttpError(404,'Pengguna tidak ditemukan');await safeLogActivity({req,action:'Hapus',module:'Master Pengguna',detail:`Hapus pengguna: ${current?.nama||current?.username||key}`});res.json({message:'Pengguna berhasil dihapus'});}catch(e){next(e);}};
async function completeLogin(req, res, user) {
  const session = await createSession(user.id);
  await safeLogActivity({ req, userId: Number(user.id), action: 'Login', module: 'Auth', detail: 'Login berhasil' });
  res.json({ user, token: createToken(user, session) });
}
export const login = async (req, res, next) => {
  try {
    const username=text(req.body?.username), password=text(req.body?.password);
    const record=username ? await repository.findUserForLogin(username) : null;
    if (!record || record.status !== 'Aktif' || !await verifyPassword(password,record.password)) throw new HttpError(401,'Username atau password salah');
    const user=await repository.findUser(record.id);
    const settings=await getSettings();
    if (settings.two_factor && (String(user.level_detail?.nama).toLowerCase() === 'admin' || user.permissions?.includes('*'))) {
      return res.json(await beginLoginChallenge(user));
    }
    await completeLogin(req,res,user);
  } catch(error) { next(error); }
};
export const verifyLoginCode = async (req,res,next) => {
  try {
    const userId=await consumeLoginChallenge(req.body?.challenge_id,req.body?.code);
    const user=await repository.findUser(userId);
    if (!user || user.status !== 'Aktif') throw new HttpError(403,'Akun tidak aktif');
    await completeLogin(req,res,user);
  } catch(error) { next(error); }
};
export const logout = async (req,res,next) => {
  try {
    let payload;
    try { payload=verifyToken(req.headers.authorization?.replace(/^Bearer\s+/i,'')); } catch { payload=null; }
    if (payload?.sid) await removeSession(payload.sid);
    res.json({ logged_out: true });
  } catch(error) { next(error); }
};

export const keepSession = async (req,res,next) => {
  try {
    let payload;
    try { payload=verifyToken(req.headers.authorization?.replace(/^Bearer\s+/i,'')); } catch { payload=null; }
    if (!payload || !await validateSession(payload)) throw new HttpError(401,'Sesi berakhir, silakan login kembali');
    res.json({ active: true });
  } catch(error) { next(error); }
};
