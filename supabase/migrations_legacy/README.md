# Legacy migrations archive

This directory contains historical SQL files that were present in the repository
but were not part of the canonical Supabase migration ledger for production.

Why they are archived:

- Many filenames used short date-only versions, with duplicated versions such as
  `20260607` and `20260608`. Supabase migration versions must be unique and
  ordered deterministically.
- Production already contains the relevant objects verified during the
  2026-07-21 baseline audit, but `supabase_migrations.schema_migrations`
  recorded only the later production migrations.
- Replaying these files against production is unsafe because some contain data
  mutations, cron setup, auth seeding, and historical incremental assumptions.

Operational rule:

- Do not run these files against production.
- Future database changes must be implemented as new forward-only migrations in
  `supabase/migrations`.
- If an archived file contains logic that is still needed, copy the required
  behavior into a new idempotent migration instead of moving the old file back.
