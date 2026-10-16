# English activity log columns

Only `public.activity_logs` changes in this migration.

| Old column | New column |
| --- | --- |
| `waktu` | `occurred_at` |
| `aksi` | `action` |
| `modul` | `module` |

`id`, `user_id`, optional `user_name`, `detail`, `ip` and `created_at` already use English names. Existing log values, including action labels and module names, are preserved. Other tables and their column names are outside this migration.

The `/api/v1/log-activity` response now returns `occurred_at`, `action` and `module`. The frontend uses these names for date grouping, timestamp display, action badges, module badges and summary counts. The endpoint path, query parameters, pagination envelope and user information are unchanged. Demo log storage and logger calls use the same schema. Historical local JSON log rows normalize to English keys on read and persist the new keys on the next write; conflicting values cause an error instead of silent data loss.

All backend log writes use the new columns, including the audit middleware, authentication, master CRUD, settings, notifications, backups and the atomic withdrawal transaction. Existing action values such as `Login`, `Tambah` and `Gagal Edit` remain the original stored values; this is a column-name migration, not a translation of audit evidence.

## Checks and deployment

1. Run `npm test` in backend and frontend, and build the frontend.
2. Run `npm run db:check:activity-log-columns`. This uses a temporary PostgreSQL schema and rolls back all test data. It tests timestamps, existing values, defaults, index dependencies, table identity, RLS, repeated application and conflicting old/new columns.
3. Run `npm run db:migrate:activity-log-columns -- --check` to simulate on the configured database with rollback.
4. Coordinate the database change with deployment of the updated backend and frontend, since the old logger and old frontend consume the previous contract.
5. Run `npm run db:migrate:activity-log-columns`, restart the updated backend, and deploy the updated frontend.

The migration performs in-place `RENAME COLUMN` operations in one transaction. It creates no legacy columns or compatibility views. It verifies the row count, table OID, column attribute numbers and a checksum of every row value. It uses a 5-second lock timeout and a 120-second statement timeout. Conflicting columns, missing required columns, lock failures or changed data trigger rollback. Re-running the migration is safe.

The bootstrap migration also applies `003_english_activity_log_columns.sql` after creating/renaming the table.
