import { pool, query } from '../config/database.js';
import { catalogWithIds } from '../data/menuCatalog.js';

const useTestStore = process.env.NODE_ENV === 'test';
const catalog = catalogWithIds();
const actions = catalog.flatMap((menu) => menu.actions);
const test = {
  levels: [{ id: 1, kode: 'LVL-001', nama: 'Admin', deskripsi: 'Akses penuh', hak_akses: '41 permission', action_ids: actions.map((a) => a.id) }],
  users: [{ id: 1, username: 'admin', password: 'scrypt$invalid$00', nama: 'Administrator', email: 'admin@company.com', level_id: 1, status: 'Aktif' }]
};

const permissionNames = (ids) => catalog.flatMap((m) => m.actions.filter((a) => ids.map(String).includes(String(a.id))).map((a) => a.permission));
const levelView = (level) => ({ ...level, action_ids: level.action_ids || [], permissions: permissionNames(level.action_ids || []), jumlah_user: test.users.filter((u) => u.level_id === level.id).length });
const userView = (user) => { const level = test.levels.find((l) => l.id === user.level_id); const { password, ...safe } = user; return { ...safe, level_detail: level ? { id: level.id, kode: level.kode, nama: level.nama } : null, permissions: permissionNames(level?.action_ids || []) }; };

export async function findLevels(search = '') {
  const term = search.trim().toLowerCase();
  if (useTestStore) return test.levels.map(levelView).filter((level) => !term || `${level.kode} ${level.nama} ${level.deskripsi || ''}`.toLowerCase().includes(term));
  return (await query(`SELECT l.*, COUNT(DISTINCT u.id)::int jumlah_user,
    COALESCE(array_agg(DISTINCT lp.menu_action_id ORDER BY lp.menu_action_id) FILTER (WHERE lp.menu_action_id IS NOT NULL), '{}') action_ids,
    COALESCE(array_agg(DISTINCT m.key || '.' || a.key ORDER BY m.key || '.' || a.key) FILTER (WHERE a.id IS NOT NULL), '{}') permissions
    FROM levels l LEFT JOIN users u ON u.level_id=l.id LEFT JOIN level_permissions lp ON lp.level_id=l.id
    LEFT JOIN menu_actions a ON a.id=lp.menu_action_id LEFT JOIN menus m ON m.id=a.menu_id
    WHERE $1 = '' OR l.kode ILIKE '%' || $1 || '%' OR l.nama ILIKE '%' || $1 || '%' OR l.deskripsi ILIKE '%' || $1 || '%'
    GROUP BY l.id ORDER BY l.id`, [search.trim()])).rows;
}
export async function findLevel(id) { return (await findLevels()).find((x) => String(x.id) === String(id)) || null; }
export async function saveLevel(id, item) {
  const ids = [...new Set(item.action_ids.map(Number))];
  if (useTestStore) {
    if (ids.some((x) => !actions.some((a) => a.id === x))) throw Object.assign(new Error('invalid actions'), { code: 'INVALID_ACTIONS' });
    if (test.levels.some((l) => l.id !== id && l.kode.toLowerCase() === item.kode.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
    if (id) { const i = test.levels.findIndex((l) => l.id === id); if (i < 0) return null; test.levels[i] = { ...test.levels[i], ...item, action_ids: ids }; }
    else { id = Math.max(0, ...test.levels.map((l) => l.id)) + 1; test.levels.push({ id, ...item, action_ids: ids }); }
    return findLevel(id);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const valid = await client.query('SELECT id FROM menu_actions WHERE aktif=TRUE AND id=ANY($1::bigint[])', [ids]);
    if (valid.rowCount !== ids.length) throw Object.assign(new Error('invalid actions'), { code: 'INVALID_ACTIONS' });
    const values = [item.kode, item.nama, item.deskripsi, `${ids.length} permission`];
    const result = id ? await client.query('UPDATE levels SET kode=$1,nama=$2,deskripsi=$3,hak_akses=$4 WHERE id=$5 RETURNING id', [...values, id]) : await client.query('INSERT INTO levels(kode,nama,deskripsi,hak_akses) VALUES($1,$2,$3,$4) RETURNING id', values);
    if (!result.rowCount) { await client.query('ROLLBACK'); return null; }
    id = result.rows[0].id; await client.query('DELETE FROM level_permissions WHERE level_id=$1', [id]);
    if (ids.length) await client.query('INSERT INTO level_permissions(level_id,menu_action_id) SELECT $1,unnest($2::bigint[])', [id, ids]);
    await client.query('COMMIT'); return findLevel(id);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function removeLevel(id) {
  const level = await findLevel(id); if (!level) return 'missing'; if (level.jumlah_user) return 'used';
  if (useTestStore) { test.levels = test.levels.filter((l) => l.id !== id); return 'removed'; }
  return (await query('DELETE FROM levels WHERE id=$1', [id])).rowCount ? 'removed' : 'missing';
}
export async function findUsers(search = '') {
  const term = search.trim().toLowerCase();
  if (useTestStore) return test.users.map(userView).filter((user) => !term || `${user.username} ${user.nama} ${user.email || ''}`.toLowerCase().includes(term));
  return (await query(`SELECT u.id,u.username,u.nama,u.email,u.level_id,u.status,u.created_at,u.updated_at,
    json_build_object('id',l.id,'kode',l.kode,'nama',l.nama) level_detail,
    COALESCE(array_agg(DISTINCT m.key||'.'||a.key ORDER BY m.key||'.'||a.key) FILTER(WHERE a.id IS NOT NULL),'{}') permissions
    FROM users u LEFT JOIN levels l ON l.id=u.level_id LEFT JOIN level_permissions lp ON lp.level_id=l.id LEFT JOIN menu_actions a ON a.id=lp.menu_action_id LEFT JOIN menus m ON m.id=a.menu_id
    WHERE $1 = '' OR u.username ILIKE '%' || $1 || '%' OR u.nama ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
    GROUP BY u.id,l.id ORDER BY u.id`, [search.trim()])).rows;
}
export async function findUser(id) { return (await findUsers()).find((x) => String(x.id) === String(id)) || null; }
export async function findUserForLogin(username) {
  if (useTestStore) return test.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
  return (await query('SELECT * FROM users WHERE LOWER(username)=LOWER($1)', [username])).rows[0] || null;
}
export async function saveUser(id, item) {
  const level = await findLevel(item.level_id); if (!level) throw Object.assign(new Error('level missing'), { code: 'INVALID_LEVEL' });
  if (useTestStore) {
    if (test.users.some((u) => u.id !== id && u.username.toLowerCase() === item.username.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
    if (id) { const i=test.users.findIndex((u)=>u.id===id); if(i<0)return null; test.users[i]={...test.users[i],...item,password:item.password||test.users[i].password}; }
    else { id=Math.max(0,...test.users.map((u)=>u.id))+1; test.users.push({id,...item}); } return findUser(id);
  }
  const values=[item.username,item.password,item.nama,item.email,item.level_id,item.status];
  const result=id ? await query(`UPDATE users SET username=$1,password=COALESCE($2,password),nama=$3,email=$4,level_id=$5,status=$6 WHERE id=$7 RETURNING id`,[...values,id]) : await query('INSERT INTO users(username,password,nama,email,level_id,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',values);
  return result.rowCount ? findUser(result.rows[0].id) : null;
}
export async function removeUser(id) { if(useTestStore){const n=test.users.length;test.users=test.users.filter((u)=>u.id!==id);return n!==test.users.length;} return Boolean((await query('DELETE FROM users WHERE id=$1',[id])).rowCount); }
