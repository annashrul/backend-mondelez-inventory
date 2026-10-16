# English level and location columns

Migration `005_english_level_location_columns.sql` renames existing columns in place:

| Table | Previous column | English column |
| --- | --- | --- |
| levels | kode | code |
| levels | nama | name |
| levels | deskripsi | description |
| levels | hak_akses | access_rights |
| locations | kode | code |
| locations | nama | name |
| locations | alamat | address |
| locations | deskripsi | description |

IDs, timestamps, soft deletion fields, stored values, indexes, foreign keys and permission assignments remain intact. Columns on other tables, including `racks.lokasi_id` and `users.level_id`, are unchanged.

The `/level-pengguna` and `/lokasi` HTTP APIs use English fields, including generated `code` responses. Level permissions still come from `action_ids` and `level_permissions`; `access_rights` is a derived summary. Legacy request fields remain accepted for compatibility; conflicting names are rejected with HTTP 422. Backend repositories explicitly map SQL fields to existing domain models used by user authentication, withdrawals and rack details. Frontend transport and demo adapters map the English API contract to existing form models.

Validation and deployment:

```sh
npm run db:check:level-location-columns
node scripts/migrate-level-location-columns.js --check
npm run db:migrate:level-location-columns
```

The first command checks isolated PostgreSQL tables inside a rolled-back transaction. The second validates the actual tables then rolls back. The migration runner locks both tables, checks row counts, row-value checksums and column identities before committing; it rolls back on failure. The migration is idempotent and rejects conflicting old/new columns.

Deploy the updated backend and frontend together with the migration. Older deployed backend code referencing legacy SQL columns requires an update.
