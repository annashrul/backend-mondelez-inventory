import { renameFields } from './itemColumns.js';
export const menuColumnRenames = Object.freeze({
  "menus": {
    "nama": "name",
    "grup": "group_name",
    "urutan": "sort_order",
    "aktif": "is_active"
  },
  "menu_actions": {
    "nama": "name",
    "urutan": "sort_order",
    "aktif": "is_active"
  }
});
export function toPublicMenu(row) {
 const output=renameFields(row,menuColumnRenames.menus);
 if(Array.isArray(output?.actions))output.actions=output.actions.map(action=>renameFields(action,menuColumnRenames.menu_actions));
 return output;
}
