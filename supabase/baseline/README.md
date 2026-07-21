# Canonical database baseline

Baseline date: 2026-07-21

This baseline records the production database shape verified from the linked
Supabase project after Guardian Engine V3 Phase 6 was activated.

The full `supabase db dump --linked --schema public` command could not be used
in this execution environment because Supabase CLI requires Docker for that
operation and Docker was unavailable. The baseline is therefore represented by:

- the cleaned executable migration ledger in `supabase/migrations`;
- the archived historical SQL in `supabase/migrations_legacy`;
- the forward-only hardening migration
  `20260721203000_baseline_rls_observability.sql`;
- remote verification queries run against production.

Verified remote facts:

- Remote migration ledger before repair contained:
  `20260716`, `20260721`, `20260721135600`, `20260721162000`,
  `20260721173000`, `20260721193000`.
- The repository migration `20260721_guardian_engine_v3_phase1.sql` was
  normalized locally to `20260721000000_guardian_engine_v3_phase1.sql`.
- Guardian Engine V3 was active for tenant
  `220e676e-ef8d-4312-814d-fb4dca962c06` at config version `4`.
- Guardian seed contained 25 guardian definitions and 193 guardian variable
  definitions.
- Critical extensions existed remotely: `pg_cron`, `pg_net`, `pgcrypto`,
  `uuid-ossp`, and `moddatetime`.
- Active remote Edge Functions were `send-messages`, `process-followups`,
  `webhook-evolution`, `webhook-inbound`, `discover-leads`, and
  `enrich-leads`.

Post-change verification checklist:

1. `supabase migration list --linked --output-format json` must show no
   unexpected local-only or remote-only rows.
2. `cron.job` must not be changed by the baseline/RLS migration.
3. Tables hardened by the baseline migration must have RLS enabled:
   `tenant_addons`, `plan_limits`, `cnpj_cache`, `cnpj_name_search_cache`,
   `whatsapp_guardian_status`, and `whatsapp_guardian_telemetry`.
4. `anon` must not retain broad privileges on those tables.
5. Pending outbound rows without Guardian evidence before the baseline must be
   blocked rather than eligible for sending.
