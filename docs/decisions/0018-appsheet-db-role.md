# ADR 0018: AppSheet back-office DB role (external principal, least-privilege)

## Status

Accepted — 2026-06-08 (model A — direct DB role).
Originally drafted 2026-06-07. The load-bearing open question
("how does AppSheet authenticate to the database?") is resolved — see
"Resolution of the load-bearing question" below. Supersedes the parked
migration `20260606210130_add_appsheet_role` (reverted in `cfa4560`;
original content recoverable from git sha `30916ee`), which was broken
(granted on a nonexistent `public.tasks`) and insecure (placeholder password
in git; blanket `grant select on all tables` exposing `audit_log` and
`users`).

Role name: **`appsheet_writer`** (renamed from the draft's `appsheet` —
the "\_writer" suffix makes the principal's purpose explicit alongside
future read-only roles).

## Context

AppSheet is to be a back-office surface for this org — most likely
read-only report/WP viewing plus work-package status updates. It connects
to the live Postgres as its own principal. This is the **first
non-Supabase-platform DB role** on the project, so it gets an ADR.

The parked migration showed exactly how this goes wrong: an over-broad
`grant select on all tables in schema public` would have handed an
external integration the entire `audit_log` (actor/target/payload trail)
and `public.users` (line_user_id, full_name, role) — a privacy and
security leak. This ADR locks the opposite posture: **start from zero,
grant only what AppSheet is demonstrated to need, never the sensitive
tables.**

## Resolution of the load-bearing question

**Confirmed: model (A) — direct Postgres connection as `appsheet_writer`.**

AppSheet at this org connects as a plain Postgres client over the Supabase
**Session Pooler** (IPv4-only, connection-per-CRUD). It is NOT using the
REST/data API. The connection carries no `auth.uid()`; every existing RLS
policy gates on `public.current_user_role()`, which reads
`public.users` by `auth.uid()` and therefore returns NULL for this role
and DENIES every read and write.

What that implies for this role's grant model:

1. **Per-table GRANTs are necessary but not sufficient.** Granting
   SELECT/INSERT/UPDATE on a table to `appsheet_writer` is just the
   privilege half; RLS still bites.
2. **Each policy AppSheet touches must be written `TO appsheet_writer`
   explicitly.** The existing `TO authenticated` policies do not apply
   (different role). The `appsheet_writer` policies must NOT call
   `current_user_role()` (NULL) or `auth.uid()` (also NULL); they should
   gate on per-row data the role legitimately owns (e.g. `source =
'appsheet'`) or be unconditional (no USING / WITH CHECK that depends
   on session identity).
3. **`BYPASSRLS` remains forbidden.** The role gets explicit policies,
   never the bypass.
4. **Views are the right primitive for cross-table reads that must hide
   PII** (e.g. surfacing a display name without granting `public.users`).

This resolution does NOT itself ship grants or policies — it sets the
shape of the work. The first table grants land in P2 of the Purchasing
unit; see "P1a / P2 split" below.

## Discarded alternative

- **(B) Via Supabase's REST/data API with a key.** Rejected because
  AppSheet's actual integration uses the Session Pooler. If the
  integration is ever moved to model (B), this ADR's grant matrix is
  invalidated and a new ADR is required — the API path is an API-key +
  RLS story, not a DB-role story.

## Decision

Create role `appsheet_writer` via migration with the narrowest grants that
serve its actual function, plus dedicated RLS policies written
`TO appsheet_writer` (model A) so it sees only the rows it legitimately
owns. The password is **never** in git (see below).

### Grant matrix — least privilege (every row marked CONFIRM needs the operator to verify AppSheet's real usage)

| Table               | Read            | Write                                                                                                                                                                                          | Rationale / posture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`          | SELECT          | none                                                                                                                                                                                           | View context for reports. CONFIRM read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `work_packages`     | SELECT          | UPDATE (`status` only)                                                                                                                                                                         | Back-office status updates. Column-scoped UPDATE, not whole-row. CONFIRM columns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `deliverables`      | SELECT          | none                                                                                                                                                                                           | Grouping context. CONFIRM.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `purchase_requests` | SELECT          | INSERT (requisitions); UPDATE (`supplier`, `order_ref`, `amount`, `purchased_at`, `delivered_at`, `received_by`, `delivery_note`; **+ `eta` per ADR 0026** — `needed_by`/`priority` protected) | Phase 2 of the Purchasing unit. AppSheet records requisitions (`source='appsheet'`) with `requested_by_email` set; later writes the purchase + delivery stages on the same row. The `TO appsheet_writer` SELECT policy gates on `source='appsheet'` (AppSheet sees only its own rows). Native (`source='app'`) rows are invisible to it. See ADR 0022 and feature spec 09. **⚠ SUPERSEDED by ADR 0025 (P2):** SELECT gated on `status IN ('approved','purchased','delivered')` instead of `source='appsheet'`; INSERT deferred to a future unit. See ADR 0025. **⚠ AMENDED by ADR 0026 (spec 16):** `eta` joins the UPDATE column list (8 columns); `needed_by`/`priority` are protected; new SELECT-only rows for `purchase_request_attachments`, `purchase_request_attachment_tokens`, and the `_appsheet` view ship in spec-16 P2 — see ADR 0026's amended matrix. |
| `approvals`         | **none**        | **none**                                                                                                                                                                                       | Append-only decision log; approval is an in-app PM action. Do NOT grant. If report views need approval status, expose via a view, not the table. CONFIRM no need.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `photo_logs`        | SELECT (if req) | **never** insert/upd/del                                                                                                                                                                       | Append-only. Photos normally reached via the app/reports, not directly. Grant SELECT only if a concrete need exists. CONFIRM.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `reports`           | SELECT (if req) | none                                                                                                                                                                                           | Report metadata listing. Files are private-bucket + signed URLs. CONFIRM.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `users`             | **NEVER**       | **NEVER**                                                                                                                                                                                      | PII (line_user_id, full_name, role). If display names are needed, expose a minimal view with only the needed column.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `audit_log`         | **NEVER**       | **NEVER**                                                                                                                                                                                      | Full audit trail. No external principal reads this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tasks`             | **n/a**         | **n/a**                                                                                                                                                                                        | Does not exist. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Default deny:** no `grant ... on all tables`. Every grant is explicit
and per-table (and per-column for writes). Anything cross-cutting is a
**view** (`security_invoker`/`security_barrier`) that exposes only the
needed columns — never a direct grant on `audit_log` or `users`.

### The `tasks` table

`tasks` does not exist in git or on the live DB. In the parked migration
it was granted **alongside** `work_packages`, so it was not a mis-name for
`work_packages` — it was a planned/aspirational table that was never
built. **Posture: drop `tasks` from the grant matrix entirely.** If a
`tasks` entity is genuinely needed, it gets its own ADR + create-table
migration first; this role grants on it only after that exists.

### Password handling (no secret in git)

The migration creates the role and grants **without** a usable login
password. The operator sets the password out-of-band, once, as a
**logged exception** under the change-management policy:

```sql
-- run by the operator in the SQL editor, NOT in a migration:
alter role appsheet_writer with login password '<generated-secret>';
insert into public.audit_log (action, target_table, payload)
values ('other', null, jsonb_build_object('event','set appsheet_writer role password','at', now()));
```

The secret lives wherever AppSheet's connection config is stored (the
integration's own secret store), tracked per the policy, and rotated on
suspicion. No placeholder, no real password, ever committed.

## P1a / P2 split for the Purchasing unit

The Purchasing data layer (P1a — ADR 0022, feature spec 09) creates
`purchase_requests` but does NOT ship any `appsheet_writer` grants or
policies. The native (authenticated) path is fully covered by the
existing role-gated policies on the table.

P2 ships, in this order, as its own unit:

1. `create role appsheet_writer noinherit nologin;` (login enabled later
   via the password exception above).
2. Per-table `GRANT`s per the matrix above.
3. RLS policies `TO appsheet_writer` on every table AppSheet touches.
   For `purchase_requests`:
   - SELECT policy gated on `source = 'appsheet'` so AppSheet sees only
     its own rows.
   - INSERT policy with `WITH CHECK (source = 'appsheet'
AND requested_by_email IS NOT NULL AND requested_by IS NULL)` —
     pinning the AppSheet half of the dual-identity contract.
   - UPDATE policy whose USING admits any AppSheet-owned row and whose
     WITH CHECK admits the purchase / delivery column writes only. The
     column-scoped UPDATE GRANT enforces the column list at the
     privilege layer; the policy is belt-and-braces.
4. pgTAP coverage for each policy under a simulated `SET ROLE
appsheet_writer` (no JWT claims — direct DB role).
5. The password is set out-of-band per "Password handling" above, with
   the corresponding `audit_log` row.

## Consequences

- **Positive:** an external principal that can touch only what it needs,
  never the audit trail or user PII; the role's creation and grants are in
  git and reviewable; the password is out of version control.
- **Negative / cost:** model (A) requires writing dedicated RLS policies
  (or views) for `appsheet_writer`, since the existing
  `current_user_role()` policies don't apply to a non-auth connection.
  That's the bulk of the P2 work; the shape of it is now known (per the
  "Resolution of the load-bearing question" section).
- **Neutral:** this ADR is numbered 0018 (after deliverables 0016 and
  profile 0017); the feature spec is `06-appsheet-role.md`. The
  `purchase_requests` grants and policies named in the matrix above ship
  in P2, NOT in the Purchasing P1a unit (ADR 0022) that creates the
  table.

## References

- Change-management policy (`docs/policies/change-management.md`) — gates
  role creation and password handling.
- ADR 0004 (audit_log immutability), ADR 0007 (`public.users`), ADR 0011
  (`current_user_role()` — why RLS won't apply to a non-auth connection).
- ADR 0022 — Purchasing domain (P1a creates `purchase_requests`; this
  ADR's grant matrix covers the P2 grants for that table).
- Parked migration original content: git sha `30916ee`.
- `docs/feature-specs/06-appsheet-role.md` — the unit spec.
