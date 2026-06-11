# ADR 0025: AppSheet purchase/delivery write path — status derivation, status-gated SELECT, SECURITY DEFINER audit

## Status

Accepted — 2026-06-08

Purchasing P2 unit. Establishes the three load-bearing decisions that shape how the `appsheet_writer` DB role fulfills purchase and delivery stages on `purchase_requests` rows.

**Supersedes two parts of ADR 0018's grant matrix** (see "Supersedes ADR 0018" section below).

**Amended by ADR 0026 (spec 16, 2026-06-11):** the column-scoped UPDATE
grant gains `eta` (8 columns) with its audit handled as a case-3
correction diff; `needed_by`/`priority` are explicitly NOT writable by
`appsheet_writer`; the native SELECT policy gains `site_admin`
(unrelated to this role's own policies, which are unchanged).

## Context

P1a (ADR 0022) shipped the `purchase_requests` table with the full lifecycle enum (`requested → approved | rejected → purchased → delivered`) and seven nullable P2 fact columns. The `appsheet_writer` role (ADR 0018) was deferred to P2.

`appsheet_writer` connects as a direct Postgres DB role via the Session Pooler — no JWT, no `auth.uid()`, `public.current_user_role()` returns NULL. Three non-obvious design questions arise:

1. **How does status advance without granting `appsheet_writer` UPDATE on the status column?**
2. **Which rows should `appsheet_writer` see — all `source='appsheet'` rows (ADR 0018), or something else?**
3. **How does an `appsheet_writer` action get into `audit_log`, given the role has no `audit_log` grant?**

## Decision A — status is DERIVED, never granted

`appsheet_writer` receives no privilege on the `status` column. It writes only fact columns (`supplier`, `order_ref`, `amount`, `purchased_at`, `delivered_at`, `received_by`, `delivery_note`; **+ `eta` since ADR 0026**). A BEFORE UPDATE trigger (`purchase_requests_derive_appsheet_status`) advances `status` when a fact-column null→non-null transition signals a lifecycle move:

- `status='approved'` AND `purchased_at` null→non-null ⇒ `NEW.status := 'purchased'`
- `status='purchased'` AND `delivered_at` null→non-null ⇒ `NEW.status := 'delivered'`
- Illegal moves (e.g. `delivered_at` set while `status<>'purchased'`) raise `P0001`.
- Corrections (e.g. `amount` changed on an already-purchased row with no null→non-null transition) leave `status` unchanged and are allowed.

**Why this over granting status + a CHECK constraint:**
Withholding the status grant makes "AppSheet cannot write `requested`/`approved`/`rejected`" a privilege-layer guarantee, not a value-policing CHECK. AppSheet's plain-UPDATE-over-pooler capability does not require RPC support; the trigger intercepts the plain UPDATE. If the trigger is bypassed (e.g. a future SECURITY DEFINER escalation), the column grant acts as a hard stop. Decision recorded as a security boundary, not just a design preference.

### Rejected alternatives

- **Grant `status` with a `CHECK` constraint** — puts transition legality in a value-policing CHECK that any privileged path can bypass. The privilege layer is cheaper and harder to bypass than a CHECK.
- **SECURITY DEFINER RPC for AppSheet writes** — AppSheet cannot call Postgres functions via plain SQL UPDATE; it needs a table-level write, not an RPC call.

## Decision B — SELECT gated on pipeline status; INSERT deferred; supersedes source-gated SELECT

ADR 0018 specified SELECT gated on `source='appsheet'` so AppSheet only sees rows it originated. P2 changes this: AppSheet fulfills **native** requisitions (created by site_admins / PMs via the app, `source='app'`). Gating on `source='appsheet'` would make AppSheet's worklist empty.

Instead, SELECT is gated on lifecycle stage: `status IN ('approved','purchased','delivered')`. These are the rows the procurement team acts on. The native `requested`/`rejected` rows are outside AppSheet's execution domain.

INSERT is deferred: AppSheet-originated requisitions (`source='appsheet'`, `requested_by_email`) are a future unit. No INSERT grant or policy ships now.

**Growth seam** (marked with `-- future:` comments in migration `…140100`): when originated-requisitions ship, SELECT becomes `status IN ('approved','purchased','delivered') OR source='appsheet'` and an INSERT policy/grant is added.

### Rejected alternatives

- **Source-gated SELECT per ADR 0018** — AppSheet sees zero rows because all current requisitions are `source='app'`. Fails the actual use case.
- **Ship INSERT-now per ADR 0018** — AppSheet-originated requisitions are a separate user-facing flow; shipping INSERT without UI/validation is scope creep.
- **Blanket SELECT (all rows)** — exposes `requested`/`rejected` rows AppSheet has no business seeing.

## Decision C — P2 audit via a second SECURITY DEFINER trigger

`appsheet_writer` has no `audit_log` grant and must never get one (`audit_log` is visible to all authenticated users; granting a DB-role direct INSERT would be a security regression). The only viable path is a SECURITY DEFINER trigger (`purchase_requests_audit_appsheet`) whose function runs as the migration owner and performs the `audit_log` INSERT under those elevated privileges — the same pattern P1b's `purchase_requests_audit_decision` uses.

**`session_user` vs `current_user` discipline:**
Inside a SECURITY DEFINER function, `current_user` is the _function owner_ (migration-owner role, typically `postgres`). `session_user` is the _connected role_ (`appsheet_writer`). The trigger captures `session_user` as the `principal` field in the audit payload. `actor_id` and `actor_role` are NULL because there is no auth user and `current_user_role()` returns NULL. This is forensically correct: the audit record shows who ran the statement (`appsheet_writer`), not an impersonated owner.

**Mutual exclusion with P1b:**
The P1b decision trigger fires WHEN `OLD.status = 'requested'`. This trigger fires WHEN `OLD.status IN ('approved','purchased','delivered')`. The two WHEN clauses are disjoint. No double-audit is possible.

**Three audit cases:**

- `approved→purchased` ⇒ action `purchase_request_purchase`, payload `{principal, supplier, order_ref, amount, purchased_at}`.
- `purchased→delivered` ⇒ action `purchase_request_delivery`, payload `{principal, delivered_at, received_by, delivery_note}`.
- Field correction (status unchanged, any of the 7 columns changed — **8 since ADR 0026 added `eta`**) ⇒ action `update`, payload `{principal, changed:{col:[old,new],...}}`. Money edits must be visible.

### Rejected alternatives

- **Granting `appsheet_writer` INSERT on `audit_log`** — `audit_log` SELECT is granted to all `authenticated`. A DB-role with direct INSERT grant widens the write surface to a non-JWT principal that can't be traced by `auth.uid()`. Unacceptable.
- **`SET LOCAL` GUC actor inside a caller-owned trigger** — `appsheet_writer` cannot SET LOCAL in a caller-owned trigger without explicit GRANT on `pg_settings` manipulation; and the approach couples the trigger to a GUC that could be set by any other session in the connection pool. Fragile.
- **TS-side INSERT from the application layer** — AppSheet is not the application layer; it connects directly to the DB. There is no TS code path between AppSheet and the DB.

## Supersedes ADR 0018 grant matrix

Two entries in ADR 0018's `purchase_requests` row are superseded by this ADR:

| Row           | ADR 0018 (superseded)      | ADR 0025 (current)                                     |
| ------------- | -------------------------- | ------------------------------------------------------ |
| SELECT policy | `source = 'appsheet'` gate | `status IN ('approved','purchased','delivered')` gate  |
| INSERT        | Grant + policy in P2       | Deferred; no INSERT grant or policy ships in this unit |

Everything else in ADR 0018 (role creation, column-scoped UPDATE grant, BYPASSRLS forbidden, password handling, audit_log/users NEVER) stands unchanged.

A pointer was added to ADR 0018 under the `purchase_requests` grant matrix row.

## Migration order

1. `20260608140000_add_appsheet_purchase_audit_actions.sql` — two `ALTER TYPE … ADD VALUE`.
2. `20260608140100_create_appsheet_writer_role.sql` — role (nologin), SELECT grant, column-scoped UPDATE grant, two RLS policies.
3. `20260608140200_create_purchase_requests_derive_appsheet_status.sql` — BEFORE UPDATE derive/guard trigger.
4. `20260608140300_create_purchase_requests_audit_appsheet.sql` — AFTER UPDATE SECURITY DEFINER audit trigger (references enum values from migration 1; must run in a separate transaction).

## Consequences

**Positive**

- AppSheet writes a plain UPDATE over the Session Pooler with no RPC support required — compatible with AppSheet's actual integration model.
- Status advancement is a DB invariant enforced at the privilege layer (no status column grant) + trigger, not in application code.
- `audit_log` is written atomically with the UPDATE (AFTER trigger, same transaction); a purchase that fails to audit cannot commit.
- No `audit_log` grant to a non-JWT principal.
- Mutual exclusion of the two AFTER UPDATE triggers is a structural guarantee (disjoint WHEN clauses), not a comment.

**Negative**

- Two triggers on `purchase_requests` (BEFORE + AFTER). Test coverage (pgTAP section H) proves the WHEN clauses don't overlap.
- The source-gated SELECT from ADR 0018 is superseded. Any future code that assumed `appsheet_writer` can only see `source='appsheet'` rows must be updated.

**Neutral**

- AppSheet-originated requisitions remain a deferred unit. The growth seam is marked with `-- future:` comments.
- The operator must set the role password out-of-band after `db push` (per change-management.md and ADR 0018 §Password handling).

## Testing note — two-tier test strategy for NOLOGIN DB roles on Supabase

Testing a `NOLOGIN` direct-DB-role on Supabase is **two-tier**, because:

1. Supabase's `postgres` role is **not a PostgreSQL superuser** — `SET SESSION AUTHORIZATION appsheet_writer` is unavailable (requires superuser or membership, and the Supabase `db query` API blocks the transaction-local `GRANT <role> TO current_user` that would grant membership).
2. The audit trigger is `SECURITY DEFINER` — inside the trigger body `current_user` collapses to the function owner (`postgres`), so `current_user = session_user = postgres` in any in-DB test. The `session_user`-vs-`current_user` distinction is invisible from pgTAP.

### Tier 1 — pgTAP (as `postgres`, no impersonation)

Covers everything provable without role-switching:

- **Trigger logic** — derive transitions (approved→purchased, purchased→delivered), illegal-move guards (P0001), field-correction diff payload, no-op WHEN tightening.
- **Grant matrix** — `has_column_privilege` / `has_table_privilege` spot-checks for all 7 permitted and 3 protected columns.
- **Policy quals** — `pg_policies.qual LIKE` assertions confirm the `status IN ('approved','purchased','delivered')` status gate on both TO-appsheet_writer policies.
- **Audit columns** — `actor_id IS NULL`, `actor_role IS NULL`, `payload->>'principal' = session_user` (proves the trigger writes `session_user`, but in this context `session_user = 'postgres'`; production value is verified by Tier 2).

### Tier 2 — out-of-band smoke (real `appsheet_writer` login, once at enablement)

Covers what pgTAP cannot test:

- **RLS row-visibility effect** — appsheet_writer sees only `approved/purchased/delivered`; `requested/rejected` are invisible.
- **Privilege 42501s** — `UPDATE status`, `UPDATE item_description`, `INSERT` all return `42501`.
- **Principal capture** — `payload->>'principal' = 'appsheet_writer'` under a real direct-DB session (proves `session_user ≠ current_user` under SECURITY DEFINER).

The Tier-2 ritual is committed to `supabase/scripts/smoke/appsheet_writer_p2.sql` and is the re-runnable regression check for any password rotation or role-touching migration. See `docs/go-live-checklist.md` § 2a for the operator steps.

**This note supersedes the prior "SET SESSION AUTHORIZATION" doctrine**, which is infeasible on this substrate.

## References

- ADR 0004 — audit_log immutability (append-only, SECURITY DEFINER write path rationale)
- ADR 0011 — SECURITY DEFINER safety checklist; `session_user` vs `current_user` discipline
- ADR 0018 — AppSheet writer role (superseded parts noted above)
- ADR 0022 — Purchasing domain (P1a table, lifecycle enum, dual-identity)
- `docs/feature-specs/09-purchasing.md` — P2 spec section
- `supabase/migrations/20260608140000_add_appsheet_purchase_audit_actions.sql`
- `supabase/migrations/20260608140100_create_appsheet_writer_role.sql`
- `supabase/migrations/20260608140200_create_purchase_requests_derive_appsheet_status.sql`
- `supabase/migrations/20260608140300_create_purchase_requests_audit_appsheet.sql`
- `supabase/tests/database/18-appsheet-writer-purchasing.test.sql`
