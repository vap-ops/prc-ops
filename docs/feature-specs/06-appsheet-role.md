# Feature Spec 06: AppSheet back-office DB role

## Status

DRAFT — 2026-06-07. Backed by **ADR 0018**. Not ready to build: gated on
two things — (1) the connection-model question in ADR 0018, and (2) the
change-management policy being adopted (this unit is the first test of
"new DB principals go through a reviewed migration, password out of git").

Replaces the parked, broken `20260606210130_add_appsheet_role` migration.

## Goal

Stand up a least-privilege `appsheet` DB principal so the back-office
AppSheet integration can do its job (likely: read report/WP data, update
work-package status) **without** any access to `audit_log` or `public.users`.

## Locked design decisions

1. **Connection model must be confirmed FIRST.** If AppSheet connects as
   a direct Postgres role → this spec applies (RLS won't auto-apply; needs
   dedicated policies/views). If it uses the Supabase REST/data API + key
   → STOP and re-scope; this spec does not apply. Do not write a line of
   SQL until the operator confirms which.
2. **Default deny.** No `grant ... on all tables`. Explicit per-table,
   per-column grants only.
3. **Never `audit_log`, never `users`.** Cross-cutting needs go through a
   minimal view, never a direct grant on these.
4. **`tasks` is out.** It doesn't exist; it's dropped from scope until a
   separate ADR + create-table migration authorizes it.
5. **No password in git.** Migration creates the role + grants with no
   usable login secret; operator sets the password out-of-band as a
   policy-logged exception (audit_log row).

## Scope — IN

- One migration: `create role appsheet` (no login password) + the
  least-privilege grants from ADR 0018's matrix + (model A) dedicated RLS
  policies or views so `appsheet` sees only what it should.
- pgTAP tests proving the negative space as hard as the positive: the
  role has the intended grants AND **cannot** read `audit_log` or `users`,
  cannot write `approvals`/`photo_logs`, cannot touch any table not in the
  matrix.
- The operator runbook for setting + rotating the password (a doc snippet,
  not a migration).

## Scope — OUT

- Creating a `tasks` table (separate ADR if ever needed).
- Any AppSheet-side configuration (lives in the AppSheet app, not this repo).
- Broadening grants "to be safe" — every grant must trace to a confirmed
  AppSheet function.

## Open questions to resolve before building (in priority order)

1. **Connection model** (ADR 0018) — direct role vs REST/key. Blocks
   everything.
2. **Exact function** — confirm AppSheet's real operations so the matrix's
   CONFIRM rows resolve: which tables it reads, whether it writes anything
   beyond `work_packages.status`, whether it needs approval status (→ view)
   or photo/report listings.
3. **RLS shape for `appsheet`** (model A) — does it see all rows in its
   granted tables, or is it scoped (e.g., per project)? Drives whether it
   needs policies or just grants + views.

## TDD plan (tests first)

- pgTAP `NN-appsheet-role.test.sql`:
  - role `appsheet` exists; is **not** `BYPASSRLS`; is **not** superuser.
  - `has_table_privilege('appsheet', 'public.audit_log', 'SELECT')` =
    FALSE; same for `public.users` (SELECT/INSERT/UPDATE/DELETE).
  - `has_table_privilege('appsheet','public.approvals','INSERT')` = FALSE;
    `…photo_logs… (INSERT/UPDATE/DELETE)` = FALSE.
  - positive grants present exactly per the confirmed matrix (e.g.
    `work_packages` SELECT + column UPDATE on `status` only;
    `has_column_privilege('appsheet','public.work_packages','role','UPDATE')`
    = FALSE as a guard that the column scope holds).
  - (model A) under the appsheet connection context, a read of a
    non-granted table returns no rows / is denied.

## Verification checklist

- [ ] Connection model confirmed and recorded in ADR 0018.
- [ ] `pnpm db:test` — new pgTAP passes, prior suite still green.
- [ ] Live: connect as `appsheet`, confirm it can do its intended reads/
      writes AND that `select * from audit_log` / `select * from users`
      are denied.
- [ ] Password set out-of-band; an `audit_log` row records it; the secret
      is stored in AppSheet's config store, not git.
- [ ] `supabase db push --dry-run --linked` returns "remote up to date"
      afterward (no drift introduced).

## If blocked

The connection-model and exact-function answers are the operator's to
give. If they're not available, STOP and surface — do not guess a grant
matrix. A wrong grant here is a production data-exposure bug, which is the
exact failure the parked migration already demonstrated.
