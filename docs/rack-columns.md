# English rack columns

Migration `007_english_rack_columns.sql` renames columns in place:

| Previous column | English column |
| --- | --- |
| kode | code |
| nama | name |
| lokasi_id | location_id |
| kapasitas | capacity |
| terisi | occupied |

The table remains `racks`. IDs, `qr_code`, timestamps and soft deletion metadata remain unchanged. Stored capacity/occupancy and item, location and withdrawal relationships are preserved. Columns on other tables, including `withdrawals.rak_id`, are outside this migration.

The `/rak` CRUD API and code generation use English fields. Legacy request fields remain accepted for compatibility; conflicting names return HTTP 422. Occupancy remains controlled by existing backend rules and cannot be overwritten through rack forms. SQL queries for items, rack QR scans, image matching and withdrawal history use the renamed physical columns and explicitly map to existing domain models. Frontend transport and demo adapters map the canonical API fields to existing forms, location selectors and QR/printing workflows. Nested domain summaries retain their existing field names.

```sh
npm run db:check:rack-columns
node scripts/migrate-rack-columns.js --check
npm run db:migrate:rack-columns
```

The isolated PostgreSQL check runs in a rolled-back transaction, exercising foreign keys, QR values, defaults, checks, indexes, RLS, idempotence and conflicts. The migration runner checks table identity, row counts, row-value checksum and column positions before committing. Deploy the matching backend and frontend together with the migration; the previously deployed backend requires these SQL changes.
