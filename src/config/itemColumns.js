// SQL and HTTP contracts use English fields. The presentation models used by
// existing stock, notification and master workflows are mapped at the boundary.
export const itemColumnRenames = Object.freeze({
  "items": {
    "kode": "code",
    "nama": "name",
    "kelompok_id": "item_group_id",
    "satuan_id": "unit_id",
    "rak_id": "rack_id",
    "stok": "stock",
    "stok_min": "min_stock",
    "harga": "price",
    "deskripsi": "description"
  },
  "item_groups": {
    "kode": "code",
    "nama": "name",
    "deskripsi": "description"
  }
});

export function renameFields(input, mapping, reverse = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const output = { ...input };
  for (const [legacy,canonical] of Object.entries(mapping)) {
    const [source,target] = reverse ? [canonical,legacy] : [legacy,canonical];
    if (!Object.hasOwn(output,source)) continue;
    if (Object.hasOwn(output,target) && output[target] !== output[source]) {
      throw Object.assign(new Error(`Conflicting item fields: ${source}, ${target}`),{status:422});
    }
    output[target] = output[source]; delete output[source];
  }
  return output;
}
export const toPublicGroup = row => renameFields(row,itemColumnRenames.item_groups);
export const fromPublicGroup = row => renameFields(row,itemColumnRenames.item_groups,true);
export function toPublicItem(row) {
  const output=renameFields(row,itemColumnRenames.items);
  if (output?.kelompok_detail) output.kelompok_detail=toPublicGroup(output.kelompok_detail);
  return output;
}
export function fromPublicItem(row) {
  const output=renameFields(row,itemColumnRenames.items,true);
  if (output?.kelompok_detail) output.kelompok_detail=fromPublicGroup(output.kelompok_detail);
  return output;
}
export function mapContractResponse(body, transform) {
  if (Array.isArray(body)) return body.map(transform);
  if (Array.isArray(body?.data)) return {...body,data:body.data.map(transform)};
  return transform(body);
}
