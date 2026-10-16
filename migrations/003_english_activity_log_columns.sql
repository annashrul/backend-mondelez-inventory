-- Rename only the remaining Indonesian columns on activity_logs.
DO $migration$
DECLARE
  migration_schema text := COALESCE(NULLIF(current_setting('inventory.migration_schema', true), ''), 'public');
  relation oid := to_regclass(format('%I.activity_logs', migration_schema));
  entry record;
  legacy_exists boolean;
  canonical_exists boolean;
BEGIN
  IF relation IS NULL THEN
    RAISE EXCEPTION 'Required table missing: %.activity_logs', migration_schema;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation AND relkind IN ('r','p')) THEN
    RAISE EXCEPTION 'activity_logs must be a table';
  END IF;
  FOR entry IN SELECT * FROM (VALUES
    ('waktu', 'occurred_at'), ('aksi', 'action'), ('modul', 'module')
  ) AS names(legacy, canonical)
  LOOP
    SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=relation AND attname=entry.legacy AND NOT attisdropped AND attnum>0) INTO legacy_exists;
    SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=relation AND attname=entry.canonical AND NOT attisdropped AND attnum>0) INTO canonical_exists;
    IF legacy_exists AND canonical_exists THEN
      RAISE EXCEPTION 'Conflicting activity log columns: % and %', entry.legacy, entry.canonical;
    ELSIF legacy_exists THEN
      EXECUTE format('ALTER TABLE %I.activity_logs RENAME COLUMN %I TO %I', migration_schema, entry.legacy, entry.canonical);
    ELSIF NOT canonical_exists THEN
      RAISE EXCEPTION 'Required activity log column missing: %', entry.canonical;
    END IF;
  END LOOP;
END;
$migration$;
