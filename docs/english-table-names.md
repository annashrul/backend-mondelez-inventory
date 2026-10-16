# English database table names

The physical tables in the `public` schema use English names. Existing English names stay as they are.

| Previous table | Current table |
| --- | --- |
| `barang` | `items` |
| `kelompok_barang` | `item_groups` |
| `satuan` | `units` |
| `lokasi` | `locations` |
| `rak` | `racks` |
| `pengambilan_barang` | `withdrawals` |
| `adjustment_stok` | `stock_adjustments` |
| `kartu_stok` | `stock_movements` |
| `log_activity` | `activity_logs` |
| `pengaturan` | `settings` |

`settings` preserves the old `pengaturan` table; it is separate from `app_settings`, which is the settings store used by the current backend. Tables such as `users`, `levels`, `menus`, `closing`, `notifications`, and `search_audit` already have English names.

The table-name migration preserves HTTP paths, permission keys, notification types, column names and JSON response fields. A later migration changes the activity log columns and API fields; see [activity log columns](activity-log-columns.md). For example, `/barang` reads `items` and still returns `nama`, `rak_detail` and `satuan_detail`. Existing frontend versions therefore continue to work. Local JSON test stores normalize legacy table keys on read and persist canonical keys on the next write. Conflicting old/new store contents are rejected rather than silently discarded.

## Deployment

1. Run `npm test`.
2. Run `npm run db:check:table-names` to exercise rename, foreign keys, row identity, legacy view removal, RLS, idempotence and conflict handling inside a temporary PostgreSQL schema. The entire check rolls back, including the test schema.
3. Prepare the updated backend on the application server. Existing backend versions that query legacy names must be replaced when applying this migration.
4. Run `npm run db:migrate:table-names -- --check` to validate against the configured database without persisting changes. The migration takes table locks and verifies row counts and table OIDs before rolling back.
5. Run `npm run db:migrate:table-names`, then start/restart the updated backend and run `npm run db:verify`.

The migration renames tables in place and removes managed compatibility views left by the earlier migration. It does not create legacy aliases. It refuses conflicting source/target tables and unrelated views, verifies unchanged row counts and table OIDs, checks that no legacy tables or views remain, and rolls back on failure. Lock timeout is 5 seconds; statement timeout is 120 seconds. Re-running is safe. `--remove-legacy-views` remains available for cleanup-only execution, with the same integrity checks.

View removal uses no CASCADE, so unrelated dependent objects must be handled explicitly. Foreign keys, sequences/defaults, indexes, triggers, grants and policies stay attached to the original table objects. Their identifier names can still contain legacy words; this migration changes table and view names, not column or constraint names.

The regular bootstrap script also applies the audit and table-name migrations after loading its base schema. The base schema is still read from the pre-existing external `../database/schema.sql` path; use the dedicated table-name migration for an existing database.

Only the `public` application schema is changed. Supabase-managed `auth`, `storage` and other system schemas are excluded.
