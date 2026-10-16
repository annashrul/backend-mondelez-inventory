import { renameFields } from './itemColumns.js';
export const masterColumnRenames = Object.freeze({
  "levels": {
    "kode": "code",
    "nama": "name",
    "deskripsi": "description",
    "hak_akses": "access_rights"
  },
  "locations": {
    "kode": "code",
    "nama": "name",
    "alamat": "address",
    "deskripsi": "description"
  }
});
export const toPublicLevel = row => renameFields(row,masterColumnRenames.levels);
export const fromPublicLevel = row => renameFields(row,masterColumnRenames.levels,true);
export const toPublicLocation = row => renameFields(row,masterColumnRenames.locations);
export const fromPublicLocation = row => renameFields(row,masterColumnRenames.locations,true);
