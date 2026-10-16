import { query } from '../config/database.js';
import { catalogWithIds } from '../data/menuCatalog.js';

const useTestStore = process.env.NODE_ENV === 'test';

export async function findAll() {
  if (useTestStore) return catalogWithIds();
  const result = await query(`
    SELECT m.id, m.key, m.name AS nama, m.group_name AS grup, m.path, m.sort_order AS urutan, m.is_active AS aktif,
      COALESCE(
        json_agg(
          json_build_object(
            'id', a.id, 'key', a.key, 'nama', a.name,
            'permission', m.key || '.' || a.key, 'urutan', a.sort_order
          ) ORDER BY a.sort_order, a.id
        ) FILTER (WHERE a.id IS NOT NULL),
        '[]'::json
      ) AS actions
    FROM menus m
    LEFT JOIN menu_actions a ON a.menu_id = m.id AND a.is_active = TRUE
    WHERE m.is_active = TRUE
    GROUP BY m.id
    ORDER BY m.sort_order, m.id
  `);
  return result.rows;
}