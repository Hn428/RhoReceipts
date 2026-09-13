# Database: PGlite locally, Supabase hosted

With `DATABASE_URL` unset the app runs on embedded PGlite (see
[ingestion.md](ingestion.md)). Setting it switches to Supabase Postgres with no
code change: same Drizzle schema, same migrations.

## Connection strings

From the Supabase dashboard, open **Connect** on the project and copy two
strings. Put both in `.env.local` locally, and in the hosting provider's
environment for a deployment.

| Variable | Supabase string | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | Transaction pooler | 6543 | The app |
| `DATABASE_MIGRATION_URL` | Session pooler | 5432 | `npm run db:migrate` |

**Why the pooler, not the direct connection.** Supabase's direct host is
IPv6-only unless the IPv4 add-on is enabled. Both pooler strings work over IPv4
from a laptop and from serverless functions.

**Why two strings.** The transaction pooler suits serverless: many short-lived
functions share a few server connections. But it gives each transaction a
different server connection, so the app's client disables prepared statements
(`prepare: false` in `src/lib/db/index.ts`). Migrations run DDL inside one
transaction and should hold a single session, so they use the session pooler.
If `DATABASE_MIGRATION_URL` is unset, migrations fall back to `DATABASE_URL`.

If the database password contains characters like `@`, `:` or `/`, they must be
percent-encoded in the URL.

## Migrations

```bash
npm run db:generate   # after a schema change: writes drizzle/NNNN_*.sql
npm run db:migrate    # applies pending migrations to DATABASE_MIGRATION_URL
```

PGlite migrates itself when the server starts (`src/instrumentation.ts`). A
hosted database never does: migrations are an explicit step before deploying,
so two app instances booting at once can't race to change the schema.

Both paths record applied migrations in `drizzle.__drizzle_migrations`, so a
database migrated by either one is understood by the other.

## Row-level security

Supabase's Data API exposes every table in the `public` schema to its `anon` and
`authenticated` roles, and the anon key is not a secret. This app never uses the
Data API. It connects as the `postgres` role, which owns the tables and so
bypasses RLS.

Migration `0010_enable_rls.sql` enables RLS on every table with no policies, which
denies the Data API roles everything. A test fails if a table exists without
RLS, so a new table needs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in its
migration. Turning the Data API off in the project settings is a sensible
second layer.

## Moving local data

There is none worth moving. Locally created companies, receipts and deliveries
come from the mock ledger, so a hosted database starts empty and fills through
the normal flow: sign in, enroll, generate.
