# English item and item-group columns

This migration only changes physical columns on `public.items` and `public.item_groups`.

| Previous column | `items` column |
| --- | --- |
| `kode` | `code` |
| `nama` | `name` |
| `kelompok_id` | `item_group_id` |
| `satuan_id` | `unit_id` |
| `rak_id` | `rack_id` |
| `stok` | `stock` |
| `stok_min` | `min_stock` |
| `harga` | `price` |
| `deskripsi` | `description` |

`item_groups` renames `kode`, `nama`, and `deskripsi` to `code`, `name`, and `description`. Other columns already have English names, including barcode, image paths, embeddings, timestamps and deletion metadata.

## API and application integration

The `/barang` and `/kelompok-barang` endpoints return canonical English fields, including single records, paginated lists, creates, updates and `{code: ...}` for code generation. Related `kelompok_detail` on the item response also uses the English group fields. Existing incoming field names are accepted at the backend presentation boundary during gradual rollout; conflicting old/new values are rejected with 422. No duplicate legacy database columns or views are created.

Frontend Axios transport converts existing form and draft models to English fields before sending JSON or multipart uploads, and converts API records back for the existing presentation components. This keeps shared stock selectors, mobile cards, voice/text searches, generated codes, image uploads and draft restoration consistent. Unrelated master endpoints such as units and racks are not converted. Demo transport follows the same English wire contract.

The internal presentation models and existing transaction/dashboard/email response structures keep their existing field names at explicit SQL aliases and DTO boundaries. Their underlying item/group queries use English physical columns. This limits the schema migration to these two tables: columns such as `withdrawals.barang_id` and `racks.lokasi_id` are not renamed. Derived fields such as `jumlah_barang` remain computed API fields. Historical search-audit snapshots retain their original structure, with labels populated from the new item contract.

## Checks and deployment

- Run backend/frontend tests, frontend lint, and frontend build.
- `npm run db:check:item-columns` exercises a temporary PostgreSQL schema and rolls back. It verifies row values, embeddings, numeric values, default stock, foreign keys (including references from withdrawals), indexes, RLS, table identity, repeat application and conflict rollback.
- `npm run db:migrate:item-columns -- --check` simulates the migration on the configured database and rolls back.
- Coordinate deployment of backend/frontend with `npm run db:migrate:item-columns`. Existing backend SQL versions require the old physical columns and must be updated.

The migration renames columns in place in one transaction. It verifies row counts, table OIDs, column attribute numbers and a checksum of every row value in both tables. Lock timeout is 5 seconds; statement timeout is 120 seconds. Missing/conflicting columns or changed data abort the migration. Re-running is safe. Existing defaults, unique constraints, foreign keys, indexes, RLS and embedding types stay attached to the same objects. Constraint/index identifiers may still contain legacy words; changing those identifiers is outside this column migration.

The bootstrap script applies this migration after the earlier table-name and activity-log migrations.
