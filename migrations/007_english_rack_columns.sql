DO $migration$
DECLARE
  migration_schema text := COALESCE(NULLIF(current_setting('inventory.migration_schema', true), ''), 'public');
  entry record;
  relation oid;
  legacy_exists boolean;
  canonical_exists boolean;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('racks','kode','code'),
    ('racks','nama','name'),
    ('racks','lokasi_id','location_id'),
    ('racks','kapasitas','capacity'),
    ('racks','terisi','occupied')
  ) AS names(table_name,legacy,canonical)
  LOOP
    relation := to_regclass(format('%I.%I',migration_schema,entry.table_name));
    IF relation IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation AND relkind IN ('r','p')) THEN
      RAISE EXCEPTION 'Required table missing: %.%',migration_schema,entry.table_name;
    END IF;
    SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=relation AND attname=entry.legacy AND NOT attisdropped AND attnum>0) INTO legacy_exists;
    SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=relation AND attname=entry.canonical AND NOT attisdropped AND attnum>0) INTO canonical_exists;
    IF legacy_exists AND canonical_exists THEN
      RAISE EXCEPTION 'Conflicting columns on %: % / %',entry.table_name,entry.legacy,entry.canonical;
    ELSIF legacy_exists THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I',migration_schema,entry.table_name,entry.legacy,entry.canonical);
    ELSIF NOT canonical_exists THEN
      RAISE EXCEPTION 'Required column missing on %: %',entry.table_name,entry.canonical;
    END IF;
  END LOOP;
END;
$migration$;
