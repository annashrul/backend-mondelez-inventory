export const activityLogColumnRenames = Object.freeze({
  waktu: 'occurred_at',
  aksi: 'action',
  modul: 'module',
});

export function normalizeActivityLog(input) {
  const row = { ...input };
  for (const [legacy, canonical] of Object.entries(activityLogColumnRenames)) {
    if (!Object.hasOwn(row, legacy)) continue;
    if (Object.hasOwn(row, canonical) && row[canonical] !== row[legacy]) {
      throw new Error(`Conflicting activity log columns: ${legacy}, ${canonical}`);
    }
    row[canonical] = row[legacy];
    delete row[legacy];
  }
  return row;
}
