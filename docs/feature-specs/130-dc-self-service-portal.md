# Spec 130 — DC self-service portal (external partner tier)

**Status:** DESIGN — 2026-06-16. **Confirm architecture before build** (see ADR
0051 open questions). **Type:** new external trust tier — auth + row-level RLS +
DB migration (prod). Highest-stakes change in the app; built in small,
exhaustively-tested units.

Operator decisions (2026-06-16): a **full DC portal** (external accounts +
row-level RLS), **DC first** (clients reuse the boundary later). Access model =
[ADR 0051](../decisions/0051-external-partner-access-model.md).

## What a DC can do (v1 scope)

Logged-in direct contractors, scoped to **their own** data only:

- **See** their profile, crew (workers), and **payment history** (their
  `dc_payments` — what they've been paid, per period). Read-first.
- **Maintain** their own info (bank, tax_id, address, id-card / bank-book docs)
  — writes go to a **pending** state a PM approves before it's active (ADR 0051
  §6 anti-fraud).

**Out of scope (v1):** a DC logging their own labor days (a separate, larger
decision — capture stays SA-entered, spec 46); seeing WPs / project data;
clients (later, same boundary).

## Units (each gated; build only after ADR 0051 is confirmed)

### U1 — external identity + binding

- `contractor` role (enum add; ADR 0008 process). `contractor_users`
  (`user_id` → `contractor_id`, many-to-one) membership table.
  `current_user_contractor_id()` SECURITY DEFINER helper (ADR 0011 pattern, no
  `public.users` self-join). Invite/claim flow: PM issues a contractor invite →
  external party logs in via LINE → bound + role set. `roleHome()` routes
  `contractor` → `/portal`.
- pgTAP: binding correctness, helper returns the right contractor / NULL,
  unclaimed login stays `visitor`, a claimed user cannot rebind to another
  contractor.

### U2 — row-level RLS + scoped money grants

- Dual-policy (internal role-level **+** external `contractor_id =
current_user_contractor_id()`) on every DC-reachable table: `contractors`
  (own row), `workers` (own crew), `labor_logs` (own), `dc_payments` (own),
  `contact_bank` (own), contact docs (own). Scoped column grants so a DC reads
  **their own** money only (ADR 0051 §4).
- pgTAP **exhaustive**: DC-A reads only A's rows across **every** table;
  DC-A → DC-B = zero rows / 42501 on every surface; internal role-level access
  unchanged; the admin client is never on the external path.

### U3 — portal read surfaces

- `/portal` segment + middleware boundary (external roles blocked from internal
  routes and vice versa, ADR 0051 §7). Profile, crew, payment-history views —
  read through the **RLS-respecting** server client, never the admin client.
- Reuses the design system; mobile-first (contractors are on phones).

### U4 — self-edit + PM approval

- Portal edit of bank/tax/docs → **pending** records (not live). A PM-side
  approval queue promotes a pending change to active; only then does it feed
  payroll / KBank (128) / PEAK (129). Audited.

## Hard rules (carried from ADR 0051)

- External sessions **never** use the service-role admin client — RLS is the
  enforcement.
- Self-entered money data is **staged + PM-approved**, never auto-active.
- Row-level isolation is **DB-enforced and pgTAP-proven**, not app-code-trusted.

## Verification (per unit)

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`; pgTAP with explicit
cross-party denial assertions (the core risk). Prod migrations (U1/U2) →
operator gate before `db:push`. Operator acceptance: claim a DC invite on a
phone, see only that contractor's payments, attempt (and fail) to reach another
contractor's data, submit a bank change and approve it from the PM side.

## Recorded seams

- **Client portal** — same model on the `project_id` axis (ADR 0013 membership);
  reuses U1–U4's boundary. Separate spec.
- DC labor self-capture; DC viewing assigned WPs/progress.
- Separate-app extraction if the same-app boundary proves leaky (ADR 0051 §7).
