// Physical database table names. HTTP routes and response fields are separate contracts.
export const tableRenames = Object.freeze({
  "adjustment_stok": "stock_adjustments",
  "barang": "items",
  "kartu_stok": "stock_movements",
  "kelompok_barang": "item_groups",
  "log_activity": "activity_logs",
  "lokasi": "locations",
  "pengambilan_barang": "withdrawals",
  "pengaturan": "settings",
  "rak": "racks",
  "satuan": "units"
});

// Existing local test stores can be read without losing records after a rename.
export function normalizeStoreTables(input) {
  const store = { ...input };
  const aliases = { ...tableRenames, adjustment: 'stock_adjustments', pengambilan: 'withdrawals', pengguna: 'users' };
  for (const [legacy, canonical] of Object.entries(aliases)) {
    if (!Object.hasOwn(store, legacy)) continue;
    if (Object.hasOwn(store, canonical) && JSON.stringify(store[canonical]) !== JSON.stringify(store[legacy])) {
      throw new Error(`Conflicting store tables: ${legacy} and ${canonical}`);
    }
    store[canonical] = store[legacy];
    delete store[legacy];
  }
  return store;
}
