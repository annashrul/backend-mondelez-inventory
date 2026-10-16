# English menu columns

Migration `006_english_menu_columns.sql` renames columns in place:

| Table | Previous column | English column |
| --- | --- | --- |
| menus | nama | name |
| menus | grup | group_name |
| menus | urutan | sort_order |
| menus | aktif | is_active |
| menu_actions | nama | name |
| menu_actions | urutan | sort_order |
| menu_actions | aktif | is_active |

IDs, keys, paths, timestamps, label values, active flags and permission assignments remain unchanged. `/menus` returns English fields for menus and nested actions. Frontend transport maps these fields for existing navigation and permission forms; the demo adapter uses the same contract. SQL filters and level action validation now use `is_active`. Permission strings retain their existing keys.

```sh
npm run db:check:menu-columns
node scripts/migrate-menu-columns.js --check
npm run db:migrate:menu-columns
```

The isolated PostgreSQL check runs inside a rolled-back transaction. The runner validates table identities, row counts, row-value checksums and column positions while holding transaction locks. It is idempotent and rejects conflicting columns. Deploy the matching backend and frontend together with this migration; older SQL queries require updating.
