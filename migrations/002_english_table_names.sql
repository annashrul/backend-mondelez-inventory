-- Rename relations in place: rows, IDs, foreign keys, indexes, triggers and RLS
-- remain attached to the same PostgreSQL table OIDs.
DO $migration$
DECLARE
  migration_schema text := COALESCE(NULLIF(current_setting('inventory.migration_schema', true), ''), 'public');
  entry record;
  legacy_oid oid;
  canonical_oid oid;
  legacy_kind "char";
  canonical_kind "char";
  marker constant text := 'inventory:legacy-table-alias:v1';
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('adjustment_stok', 'stock_adjustments'),
    ('barang', 'items'),
    ('kartu_stok', 'stock_movements'),
    ('kelompok_barang', 'item_groups'),
    ('log_activity', 'activity_logs'),
    ('lokasi', 'locations'),
    ('pengambilan_barang', 'withdrawals'),
    ('pengaturan', 'settings'),
    ('rak', 'racks'),
    ('satuan', 'units')
  ) AS names(legacy, canonical)
  LOOP
    legacy_oid := to_regclass(format('%I.%I', migration_schema, entry.legacy));
    canonical_oid := to_regclass(format('%I.%I', migration_schema, entry.canonical));
    legacy_kind := NULL;
    canonical_kind := NULL;
    SELECT relkind INTO legacy_kind FROM pg_class WHERE oid=legacy_oid;
    SELECT relkind INTO canonical_kind FROM pg_class WHERE oid=canonical_oid;

    IF legacy_kind IN ('r','p') THEN
      IF canonical_oid IS NOT NULL THEN
        RAISE EXCEPTION 'Both legacy and canonical relations exist: %.% / %.%', migration_schema, entry.legacy, migration_schema, entry.canonical;
      END IF;
      EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', migration_schema, entry.legacy, entry.canonical);
      canonical_oid := legacy_oid;
      canonical_kind := legacy_kind;
      legacy_oid := NULL;
    ELSIF legacy_oid IS NOT NULL THEN
      IF legacy_kind <> 'v' OR obj_description(legacy_oid, 'pg_class') IS DISTINCT FROM marker THEN
        RAISE EXCEPTION 'Unexpected legacy relation: %.%', migration_schema, entry.legacy;
      END IF;
    END IF;

    IF legacy_oid IS NOT NULL AND canonical_oid IS NULL THEN
      RAISE EXCEPTION 'Canonical table missing for legacy view: %.%', migration_schema, entry.legacy;
    END IF;

    IF canonical_oid IS NOT NULL THEN
      IF canonical_kind NOT IN ('r','p') THEN
        RAISE EXCEPTION 'Canonical relation is not a table: %.%', migration_schema, entry.canonical;
      END IF;
      -- Remove only the compatibility views created by the previous migration.
      -- No CASCADE: unrelated dependent objects cause a rollback.
      IF legacy_oid IS NOT NULL THEN
        EXECUTE format('DROP VIEW %I.%I', migration_schema, entry.legacy);
      END IF;
    END IF;
  END LOOP;
END;
$migration$;
