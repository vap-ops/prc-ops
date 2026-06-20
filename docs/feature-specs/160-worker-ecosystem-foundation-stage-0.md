# Spec 160 — Worker-ecosystem foundation (Stage 0)

Under **[ADR 0061](../decisions/0061-worker-ecosystem-mission-and-foundation-invariants.md)**
(foundation invariants) — Stage 0 is the **spine the whole ecosystem hangs on**,
built **before any economics**. It also delivers the long-promised **`DC → Project`
correction** that closes the original "site admins can't find the DCs" thread (the
real fix behind [spec 158](158-dc-labor-picker-discoverability.md), whose search was
only a bridge) and the [pay-model] reality that **a DC belongs to a project, not a
crew**.

Invariants this stage pays (ADR 0061): **(1)** DC = durable person-identity (project
= current assignment); **(2)** event-sourced coin ledger; **(3)** pluggable
earn-sources; **(5/6)** portability + the portal as the worker's home. No earn-rules,
no coin value, no dials — just the spine.

## Units

- **U1 — DC as a durable person + project assignment (THIS unit).** Realizes
  invariant 1. The stable `workers` row **is** the person; add a **current project**
  - an **append-only move history**, and **drop the contractor force-tie**.
- **U2 — event-sourced coin-ledger skeleton.** Invariant 2/3: an append-only
  `coin_postings` table (`source · reason · amount · occurred_at`), balance **derived**
  (never a mutated integer), sources pluggable. No economics yet. Own unit.
- **U3 — portal as the worker's home.** Invariant 5/6: extend the external portal
  (ADR 0051) into the ecosystem home surface. Own unit, detailed later.

## U1 detail — `DC → Project`

Current schema contradicts the model: `workers` **force-ties a DC to a
`contractor_id`** (CHECK `workers_dc_has_contractor`) and has **no `project_id`**
(see [create_workers.sql](../../supabase/migrations/20260619000200_create_workers.sql)).
Target: a DC has a **current project** (single, nullable until assigned) + an
**append-only move stream** (mirrors `equipment_movements`, ADR 0055); the contractor
link becomes **optional**.

- **Migration (additive, reversible):**
  - `alter table workers add column project_id uuid null references projects(id)` —
    the **current** assignment (one project at a time).
  - **Drop** CHECK `workers_dc_has_contractor` (a DC may now have a null contractor).
    Keep `workers_own_has_no_contractor` and the `contractor_id` column (now optional
    for DC — not dropped; back-compat + existing rows untouched).
  - `worker_project_moves` — append-only history: `id`, `worker_id` (FK),
    `project_id` (nullable = moved-out/unassigned), `moved_at`, `moved_by`, `reason`.
    No UPDATE/DELETE grants; current assignment is `workers.project_id`, the stream is
    the audit trail. RLS on; zero write grant (RPC-only).
  - **RPC** `assign_worker_to_project(p_worker, p_project, p_reason)` — SECURITY
    DEFINER, pinned `search_path`; gate `current_user_role() in ('project_manager',
'super_admin')` → else `42501`; sets `workers.project_id` **and** inserts a
    `worker_project_moves` row in one transaction; writes an `audit_log` row.
- **No backfill of existing DCs' `project_id`** here (nullable; populated going
  forward) — separate, data-only follow-up.

## TDD

Failing tests first.

1. **pgTAP** `95-worker-project-assignment.test.sql`: catalog (`workers.project_id`
   column + FK; `worker_project_moves` table append-only — no UPDATE/DELETE
   privilege); the **relaxed CHECK** (a `dc` worker inserts with null `contractor_id`
   — previously `23514`, now succeeds); `assign_worker_to_project` sets `project_id`
   - appends a move row + an audit row; role gate (pm/super pass; `site_admin` /
     `visitor` → `42501`); moving again appends a second move row (history grows).

## Scope — IN

1. The migration (`project_id` + drop the DC-contractor CHECK + `worker_project_moves`
   - `assign_worker_to_project` RPC).
2. The pgTAP file. `database.types.ts` regenerated after `db:push`.

## Scope — OUT (own units)

- **U2** coin-ledger skeleton, **U3** portal home.
- **Project-scoped labor picker** (spec 158 U2) — now _possible_ once `project_id`
  exists; its own UI unit.
- **Backfill** existing DCs' project assignment (data-only).
- **Dropping `contractor_id`** for DC entirely (kept optional for now).
- Any economics: coin value, earn-rules, sell table, settlement, multiplier (ADR
  0060 dials) — all deferred per ADR 0061's decided build order.

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:push && pnpm db:test` (+
  `pnpm db:types`) — all green.
- Live: a PM assigns a DC to a project → `workers.project_id` set, a move row +
  audit row written; a DC can be created with no contractor without error.
