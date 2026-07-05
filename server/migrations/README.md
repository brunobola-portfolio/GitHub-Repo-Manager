# server/migrations

This directory holds **no SQL files** and is not a migration runner.

The schema has a single source of truth:

- **`server/db.js`** — `initDB()` applies the idempotent base schema
  (`CREATE TABLE/INDEX IF NOT EXISTS`).
- **`server/lib/db-migrations.js`** — the ordered, versioned migrations applied
  after the base schema, recorded in the `schema_migrations` ledger.

The standalone `00X-*.sql` files that used to live here were a third, drifting
copy of the schema that nothing executed. They were removed. **Do not re-add
`.sql` files here** — add a new entry to `MIGRATIONS` in
`server/lib/db-migrations.js` (next version number) instead.
