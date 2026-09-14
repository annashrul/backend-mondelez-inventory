import { query } from '../config/database.js';
import { catalogWithIds } from '../data/menuCatalog.js';

const useTestStore = process.env.NODE_ENV === 'test';

export async function findAll() {
  if (useTestStore) return catalogWithIds();
  const result = await query(`
    SELECT m.id, m.key, m.nama, m.grup, m.path, m.urutan, m.aktif,
      COALESCE(
        json_agg(
          json_build_object(
            'id', a.id, 'key', a.key, 'nama', a.nama,
            'permission', m.key || '.' || a.key, 'urutan', a.urutan
          ) ORDER BY a.urutan, a.id
        ) FILTER (WHERE a.id IS NOT NULL),
        '[]'::json
      ) AS actions
    FROM menus m
    LEFT JOIN menu_actions a ON a.menu_id = m.id AND a.aktif = TRUE
    WHERE m.aktif = TRUE
    GROUP BY m.id
    ORDER BY m.urutan, m.id
  `);
  return result.rows;
}