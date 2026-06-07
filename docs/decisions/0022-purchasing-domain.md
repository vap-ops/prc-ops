# ADR 0022: Purchasing domain — single stateful table, dual-identity, v1 requester narrowing

## Status

Accepted — 2026-06-08

Establishes the Purchasing domain (the first business workflow after
work-package approvals). Specifies the data shape, the access model, the
relationship to ADR 0018 (AppSheet writer role, P2), and the v1 requester
narrowing the owner decided on 2026-06-07.

## Context

A new requisition / approval / purchase / delivery workflow is needed for
the back office to track material requests against work packages. The
"happy path" of a single requisition is:

1. A site_admin / project_manager / super_admin on the LINE-authed app
   requests an item against a WP.
2. A project_manager or super_admin approves or rejects the request,
   recording a decision comment when rejecting.
3. The procurement team — operating through AppSheet, NOT the LINE app —
   records the purchase (supplier, order ref, amount) once placed.
4. AppSheet records the delivery (received_by, delivery_note) once received.

Three load-bearing design questions:

### Q1: Single stateful table vs append-only event log vs supersede chain?

The codebase has three established patterns:

- **`audit_log` / `approvals` / `photo_logs` (append-only).** Triple-enforced
  via REVOKE + RLS (no UPDATE/DELETE policies) + BEFORE-UPDATE/DELETE
  trigger. Used when every state change is itself a piece of permanent
  evidence and a row never logically changes after creation.
- **`photo_logs` / future `dc_entries` (supersede).** A "logical edit" is a
  new row pointing back at the old via `superseded_by`. Used when a single
  logical record has a current state that can be edited but the prior
  versions must remain queryable.
- **`projects` / `work_packages` (stateful).** Mutable rows with `updated_at`
  triggers. Used when the row IS the live state and the workflow doesn't
  need to preserve intermediate versions.

Purchasing fits the stateful model:

- Each requisition is one logical record walking a known lifecycle
  (`requested → approved | rejected → purchased → delivered`). The
  business cares about _where the requisition is now_, not "what the
  requester originally asked for before the procurement team adjusted it."
- The lifecycle is mostly linear; supersede's "edit history" semantic
  doesn't fit — there is no edit, only state advance.
- Append-only event log would either require a parent `purchase_requests`
  table with a child `purchase_events` table (two tables, joins on every
  read), or it would force the procurement / delivery columns into separate
  rows that have to be reduced back into the current state. Both are heavier
  than needed for a single-workflow back-office record.
- The auditability of state changes (who approved / when, who recorded the
  purchase / when) is preserved via the `approved_by` / `decided_at` /
  `decision_comment` columns on the row itself and (post-P1a) via
  `audit_log` entries.

**Decision: single stateful table with the full lifecycle as columns on the
row.**

### Q2: How is the requester identified? (dual-identity)

Native (LINE-authed) requests carry a `requested_by` FK to `public.users`.
AppSheet does not authenticate via Supabase Auth — it connects as a direct
DB role (see ADR 0018) with no `auth.uid()`. AppSheet rows therefore have
no `public.users` row to point at.

Three options:

- **(A) Single FK.** Force every requester to have a `public.users` row.
  Requires AppSheet to provision a "shadow" user record before requesting.
  Couples two systems together.
- **(B) Single text column.** Drop the FK entirely; store an identifier
  (email or display name) on every row. Loses native-app type safety.
- **(C) Dual-identity, gated by `source`.** Two columns + a discriminator:
  `requested_by uuid references public.users`, `requested_by_email text`,
  `source text` with CHECK `(source = 'app' AND requested_by IS NOT NULL)
OR (source = 'appsheet' AND ...)`. Native rows use the FK; AppSheet rows
  use the email.

**Decision: (C) dual-identity.** Enforced by `pr_source_valid` and
`pr_native_has_requester` CHECKs. The `users.email` bridge (resolving an
AppSheet `requested_by_email` back to a user row in the UI) is a future
unit; P1a does not need it.

### Q3: Who can request? (v1 requester narrowing)

The original sketch was "any non-visitor role." The 2026-06-07 diagnostic
on `public.work_packages` SELECT showed the policy admits only
`site_admin`, `project_manager`, and `super_admin`. The owner decided
(2026-06-07) to narrow the v1 requester base to the same set: only the
roles that can read `work_packages` to pick one. Broadening the requester
base is a future unit (procurement / technician / etc. requesting against
WPs they can see). The narrowing is enforced by the INSERT policy's
`current_user_role()` check.

## Decision

### Schema

Single migration `20260608120000_create_purchase_requests.sql`. Lifecycle
enum + table with three column groups (requisition, approval, P2 purchase

- delivery), six CHECK constraints, two indexes, an `updated_at` trigger
  reusing the existing `public.set_updated_at()` function.

### Access (RLS)

Reuses `public.current_user_role()` (ADR 0011 — never self-join
`public.users`). Three policies:

- **SELECT** admits `requested_by = auth.uid()` OR
  `current_user_role() in ('project_manager','procurement','super_admin')`.
  Site_admins see rows they requested but NOT another SA's rows
  (cross-user isolation within the SA tier). Procurement reads but does
  not write the decision — the back-office reviewer role.
- **INSERT** admits `current_user_role() in
('site_admin','project_manager','super_admin')` AND pins
  `requested_by = auth.uid()` AND pins `source = 'app'`. The three pins
  encode three guarantees: only the v1 requester base, requester is the
  caller, AppSheet path doesn't reach RLS by accident.
- **UPDATE** admits `current_user_role() in
('project_manager','super_admin')`. Column / transition scoping (which
  columns may change on which transition) is enforced in the server action
  via a two-layer guard, NOT in RLS. The action's
  `.eq('status','requested')` clause is the SQL safety net the WITH CHECK
  is intentionally NOT carrying.
- **No DELETE policy.** Hard deletes require a service-role context.

| Role                                                                          | SELECT   | INSERT       | UPDATE |
| ----------------------------------------------------------------------------- | -------- | ------------ | ------ |
| `site_admin`                                                                  | own only | self / `app` | denied |
| `project_manager`                                                             | all      | self / `app` | yes    |
| `super_admin`                                                                 | all      | self / `app` | yes    |
| `procurement`                                                                 | all      | denied       | denied |
| `visitor`                                                                     | nothing  | denied       | denied |
| `technician` / `hr` / `accounting` / `subcon_manager` / `project_coordinator` | nothing  | denied       | denied |

### Server actions

Two functions in `src/app/requests/actions.ts`, both using the session
(anon-key) client — RLS is the load-bearing authorisation primitive.

- `createPurchaseRequest({ workPackageId, itemDescription, quantity, unit })`
  validates via the pure `validateCreatePurchaseRequest` helper, then
  INSERTs with `requested_by = user.id`, `source = 'app'`.
- `decidePurchaseRequest({ id, decision, comment? })` validates via the
  pure `isPurchaseDecision` / `isDecisionCommentValid` predicates, then
  runs the **two-layer transition guard** UPDATE — JS predicate plus the
  `.eq('status','requested')` SQL clause. 0 rows ⇒ "not in requested
  state." Mirrors `recordDecision` exactly.

### Phase-2 columns are forward-compatible

`supplier`, `order_ref`, `amount`, `purchased_at`, `delivered_at`,
`received_by`, `delivery_note` are created NULLABLE in this unit. The
AppSheet writer role in P2 will GRANT column-scoped UPDATE on the
purchase / delivery subset; no further ALTER expected. The pgTAP catalog
section pins existence + type for each of these columns so a P2 column
rename surfaces as a test failure.

## Relationship to ADR 0018 (AppSheet writer role)

ADR 0018 was DRAFT pending the load-bearing connection-model question:
does AppSheet authenticate via Supabase Auth (RLS applies) or as a direct
DB role (RLS inert)? That question is now resolved — **model (A), direct
DB role over the Session Pooler.** See the same-PR update to ADR 0018.

This implies the P2 work needs **two** things for `purchase_requests`:

1. Column-scoped GRANTs to `appsheet_writer` (SELECT + INSERT for
   requisitions; UPDATE on the purchase/delivery columns only).
2. Per-policy RLS written `TO appsheet_writer` — the existing policies
   gate on `current_user_role()`, which returns NULL for a connection
   with no `auth.uid()`, so every existing policy DENIES AppSheet by
   construction.

P1a does NOT ship those. The current grants and policies cover the
native (authenticated) path only.

## Consequences

**Positive**

- One table, three policies, no joins for current-state reads.
- The dual-identity contract is enforced at the database, not in the
  application — an AppSheet row that forgot `requested_by_email` is
  rejected; a native row that forgot `requested_by` is rejected; an
  unknown `source` value is rejected.
- The v1 requester narrowing is enforced at the policy, not in the UI —
  bypassing the form does not bypass the rule.
- Forward-compatible with P2's AppSheet stages (no further ALTER).

**Negative**

- A site_admin who requests an item cannot see other SAs' requests. PM
  / procurement / super sees everything. This is the intended scoping
  but reviewers should know the rule before reading the UI.
- The two-layer guard pattern requires discipline — the server action
  is the place where transition scoping lives, not RLS. Mirrors
  `recordDecision`; if the project ever needs a stricter contract,
  promote the guard to a `SECURITY DEFINER` RPC the way ADR 0017 did
  for `update_my_display_name`.

**Neutral**

- The lifecycle enum has all five states from day one. The native decide
  path only writes `approved` / `rejected`; `purchased` / `delivered` are
  reserved for the P2 AppSheet writer.
- `database.types.ts` is manually patched in this unit to add
  `purchase_requests` and `purchase_request_status`. The patch is
  superseded by `pnpm db:types` after the delegated post-merge `db push`.

## Open questions

None blocking.

- **`audit_log` integration.** Whether decisions write an `audit_log`
  row in P1b. Strong lean toward yes; deferred to the unit that ships
  the decision UI so the action layer can attach the row in one place.
- **`users.email` bridge.** Surfacing the AppSheet requester in the
  native UI requires resolving `requested_by_email` back to a user
  display name. Future unit.

## References

- ADR 0011 — `public.current_user_role()` (mandatory primitive for every
  role-gated policy)
- ADR 0013 — Project access model (the role-level access pattern this
  ADR extends)
- ADR 0017 — Profile self-edit (the SECURITY DEFINER RPC pattern, the
  escalation path if the two-layer guard becomes inadequate)
- ADR 0018 — AppSheet DB role (the P2 work this ADR forward-promises)
- ADR 0021 — `getClaims` local JWT verify (the read-render path the
  P1b UI will run on)
- `docs/feature-specs/09-purchasing.md` — the locked unit spec
- `supabase/migrations/20260608120000_create_purchase_requests.sql`
- `supabase/tests/database/17-purchase-requests.test.sql`
