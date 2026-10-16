import { renameFields } from './itemColumns.js';
export const rackColumnRenames = Object.freeze({
  "racks": {
    "kode": "code",
    "nama": "name",
    "lokasi_id": "location_id",
    "kapasitas": "capacity",
    "terisi": "occupied"
  }
});
export const toPublicRack = row => renameFields(row,rackColumnRenames.racks);
export const fromPublicRack = row => renameFields(row,rackColumnRenames.racks,true);
