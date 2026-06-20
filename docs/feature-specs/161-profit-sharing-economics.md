# Spec 161 — Profit-sharing economics (the WP profit engine + Nova coins)

Implements **[ADR 0060](../decisions/0060-project-profit-sharing-nova-coins.md)**
(Accepted 2026-06-20) — the self-governance economic engine, built on the Stage-0
spine ([spec 160](160-worker-ecosystem-foundation-stage-0.md): DC-as-person, the coin
ledger, the portal home). Every economic **dial is editable data seeded with a
default** (operator tunes live — the "tune before build" requirement), never a
hardcoded constant. WP P&L + sell rates are **baht** (real money); **Nova coins** are
the separate reward layer (abstract points, per-item shop pricing — no baht peg) that
settles from banked baht profit at project close.

## Units (roadmap)

- **U1 — per-level rate foundation (THIS unit).** Worker **skill level** (Senior /
  Mid / Junior / Apprentice) + the editable **sell-rate table** (per level: baht cost
  band · internal-WP sell · external-WP sell), seeded with defaults. The dials the WP
  P&L will read.
- **U2 — WP economic identity.** A WP's **budget** (PD sets) + **internal/external**
  flag — isolated in a zero-grant `wp_economics` table (budget is money, hidden from
  non-HT DCs), the WP-level inputs the P&L reads.
- **U2b — HT (Head Technician) assignment.** One promoted DC per project, exclusive
  WP owner (PM assigns). Project-level; its own unit.
- **U3 — WP profit engine.** `profit = budget − (equipment rental + DC labor @ SELL +
materials)`; bank per WP at completion. Reconciles to the GL (ADR 0057), not a
  second costing path.
- **U4 — project settlement.** At project close: sum banked WP profits × the editable
  **project multiplier** → the coin pool.
- **U5 — coin distribution.** HT cut (editable %) + split by level weight
  (internal > external; externals invisible-locked) → posts to the `coin_postings`
  ledger (spec 160 U2).
- **U6 — Nova shop + saver's bonus + vesting/confiscation.** Per-item coin pricing;
  saver's bonus (editable rate); **narrow** confiscation list; the post-warranty
  **vesting tail** (vested coins are the worker's to keep — ADR 0060 trust posture).

Built strictly in order; each is its own unit. Coin **value** stays abstract (points);
**markup %** calibration waits on real utilization data (ADR 0060 open dial).

## U1 detail — worker levels + the editable sell-rate dials

ADR 0060 §2: **DC pay (cost) is per individual; sell price is per LEVEL** — a small
editable rate table, "the company always keeps the markup." Internal WP charges the
**lower** sell; external WP the **higher**. This unit builds the level attribute + the
seeded rate table; nothing reads it yet (U3 does).

- **Migration (additive):**
  - `worker_level` **enum** = `('senior', 'mid', 'junior', 'apprentice')` (ADR 0060
    §1; "set to change" → values evolve via `add value`).
  - `workers.level public.worker_level null` — the worker's grade (null = unrated;
    assigned going forward). It is a **category, not money** → `grant select (level)`
    to authenticated (like `worker_type`).
  - **`set_worker_level(p_worker, p_level)`** — SECURITY DEFINER, **super_admin** only
    (grading is an operator decision on objective criteria — the anti-favoritism
    pillar, ADR 0060 §5) → else `42501`; validates worker exists (P0001); sets
    `workers.level`; audits (`worker_change`, `payload.kind='level_change'` — reuses
    the action, no enum-add).
  - **`sell_rate_table`** — one row per level: `level public.worker_level PRIMARY KEY`,
    `cost_band`, `internal_sell`, `external_sell` (all `numeric(20,4)`), `updated_by`,
    `updated_at`. **MONEY posture** (sell prices = margin-sensitive): RLS on,
    `revoke all` — **zero authenticated grant**; the operator surface reads it via the
    admin client behind `requireRole(super_admin)` (the `day_rate` posture, spec 46).
    **Seeded** with recommended defaults (operator retunes in-app):

    | level      | cost_band | internal_sell | external_sell |
    | ---------- | --------- | ------------- | ------------- |
    | senior     | 650       | 800           | 950           |
    | mid        | 550       | 700           | 850           |
    | junior     | 450       | 580           | 720           |
    | apprentice | 380       | 480           | 600           |

  - **`set_sell_rate(p_level, p_cost_band, p_internal_sell, p_external_sell)`** —
    SECURITY DEFINER, **super_admin** only → else `42501`; non-negative amounts
    (P0001); updates the level's row (`updated_by = auth.uid()`, `updated_at = now()`);
    audits the change (action `update`, `target_table='sell_rate_table'`, payload
    old/new — generic action, no enum-add).
  - **No `project_manager` in any gate** → the ADR 0058 invariants (pgTAP 90/91) are
    not triggered (super_admin-only is intentional — leveling + rates are operator
    economics).

### U1 TDD

**pgTAP** `98-sell-rate-foundation.test.sql`: catalog (`worker_level` enum labels;
`workers.level` column + type; `sell_rate_table` table + columns; `level` is the PK);
**seed** (4 rows, the default values present); **money posture** (authenticated has no
SELECT on `sell_rate_table`); `set_worker_level` sets the grade + audits, gate
(super passes; pm / visitor → 42501; unknown worker → P0001); `set_sell_rate` updates
a level's rates + audits, gate (super passes; pm → 42501; negative → P0001).

## U1 Scope — OUT (later units)

- Anything that **reads** the rates (the WP P&L) — **U3**.
- WP budget / `is_external` — **U2**; HT — **U2b**. Coin distribution — **U5**.
- A per-worker individual **cost** field distinct from the level cost band (the model
  says cost is per-individual; the worker's `day_rate` already carries it — wiring
  cost into the P&L is U3, not a new column here).
- Rate-change **history** beyond the current editor + the audit row (append-only rate
  history, if needed, is a later refinement).

## U2 detail — WP economic identity (budget + internal/external)

ADR 0060 §1/§2: the **PD sets each WP's budget**; an **internal** WP (our team) charges
the lower sell, an **external** WP (assisting a subcontractor) the higher. Budget is the
**profit denominator** — money, hidden from non-HT DCs — so it lives in its own
**zero-grant** table (the `wp_labor_costs` posture), not a `work_packages` column whose
table grant would leak it. Nothing computes profit yet (U3); this unit just captures the
two inputs.

- **Migration (additive):**
  - **`wp_economics`** — one row per WP: `work_package_id` (PK, FK → work_packages,
    `on delete cascade`), `budget numeric(20,4) null` (unset until the PD sets it;
    `>= 0` when set), `is_external boolean not null default false`, `updated_by`,
    `updated_at`. **MONEY posture**: RLS on, `revoke all` — **zero authenticated
    grant**; pm/director/super read via the admin client (the `wp_labor_costs` /
    `day_rate` posture). The row is **upserted** by the setters (a WP with no row =
    no budget, internal by default).
  - **`set_wp_budget(p_wp, p_budget)`** — SECURITY DEFINER, **`project_director` +
    `super_admin`** (the PD sets the budget — ADR 0060 §1; the anti-favoritism root is
    "benchmark budget to scope") → else `42501`; WP exists (P0001); budget `>= 0`
    (P0001); upserts `budget` (preserving `is_external`); audits. **No
    `project_manager` reference** → pgTAP 90/91 not triggered.
  - **`set_wp_external(p_wp, p_is_external)`** — SECURITY DEFINER, \*\*`project_manager`
    - `project_director` + `super_admin`** (PM classifies the WP) → else `42501`; WP
      exists (P0001); upserts `is_external` (preserving `budget`); audits. **References
      `project_manager` → `project_director` is included\*\* (ADR 0058 invariant).
  - Audits use the generic `update` action, `target_table='wp_economics'`,
    `target_id = work_package_id` (no enum-add).
  - Gates are **role-only** (not membership-scoped) for v1 — budget's gate
    (director/super) is see-all anyway; PM membership-scoping on `set_wp_external` is a
    later refinement if needed.

### U2 TDD

**pgTAP** `99-wp-economics.test.sql`: catalog (`wp_economics` table; `work_package_id`
PK + FK; `budget` / `is_external` columns; `is_external` default false); **money
posture** (authenticated has no SELECT); `set_wp_budget` — director + super set the
budget (upsert), pm / visitor → 42501, unknown WP / negative → P0001; `set_wp_external`
— pm + director set the flag, site_admin / visitor → 42501, unknown WP → P0001; an
**upsert preserves the other column** (set budget then set is_external on one WP →
both coexist); the changes are audited.

## U2 Scope — OUT

- HT assignment — **U2b**. Reading these inputs into a profit number — **U3**.
- Per-WP membership-scoping of the setters (role-only for now).

## U2b detail — HT (Head Technician) assignment

ADR 0060 §1: the **HT is a promoted DC, one per site, exclusive WP owner**; the **PM
assigns** HTs. A project has exactly one HT — so it's a single nullable column on
`projects` (the single column _is_ the one-per-project rule), assigned via an RPC.

- **Migration (additive):**
  - `projects.ht_worker_id uuid null references workers(id)` — the project's Head
    Technician. **Not money** (a role designation) → add it to the projects per-column
    SELECT grant (the maintenance rule in `20260626000200`: a new non-money projects
    column must be granted or the app can't read it).
  - **`assign_project_ht(p_project, p_worker)`** — SECURITY DEFINER, pinned
    `search_path`; **`project_manager` + `project_director` + `super_admin`** (PM
    assigns — §1; references project_manager → director included, ADR 0058) → else
    `42501`; project exists (P0001); the worker must be an **active DC** (`worker_type
= 'dc'` and `active` — "a promoted DC") → else P0001; sets `ht_worker_id`
    (overwriting — one HT per project, last-wins); audits (generic `update` action,
    `target_table='projects'`, `target_id = p_project`). Role-only (not
    membership-scoped) for v1, like U2.
  - Not enforced: one-project-per-worker (a DC _could_ run two sites — the model only
    fixes one-HT-per-project); unassign (assign a different HT to replace; a clear is
    a later refinement).

### U2b TDD

**pgTAP** `100-project-ht.test.sql`: catalog (`projects.ht_worker_id` column + type +
FK → workers); `assign_project_ht` SECURITY DEFINER; pm assigns an active DC →
`ht_worker_id` set + audited, director overwrites (one-per-project, last-wins),
site_admin / visitor → 42501, a non-DC (own) worker / an inactive DC / unknown project
/ unknown worker → P0001.

### U2b Scope — OUT

- The HT's powers (sees the real WP P&L, takes the max coin cut) — **U3 / U5**.
- One-project-per-HT uniqueness; an unassign/clear path.

## U3 detail — WP labor priced at SELL (`wp_labor_sell`)

ADR 0060 §2: `WP profit = budget − (equipment rental + DC labor @ SELL + materials)`.
**This sub-unit builds only the novel core of that formula — the SELL-priced DC labor
term**, the one number no existing function produces. (`freeze_wp_labor_cost` already
sums DC labor at **cost**; this sums the _same current logs_ at the per-level **sell**
rate — the markup the company keeps.) The full profit assembly (subtract equipment +
materials from `wp_economics.budget`) and the GL reconciliation are **U3b**; settlement
× multiplier is **U4**. Nothing is banked or posted here — `wp_labor_sell` is a pure
**read** the P&L will compose.

- **`wp_labor_sell(p_wp uuid) returns numeric`** — SECURITY DEFINER, `stable`, pinned
  `search_path = public`. Returns the WP's DC labor valued at the per-level sell rate, in
  baht.
  - **Population — current DC labor only.** Sum over `labor_logs` rows where
    `work_package_id = p_wp`, `worker_type_snapshot = 'dc'` (ADR §2 prices **DC** labor;
    company-`own` labor is payroll overhead, not transfer-priced into the WP profit
    center — and so is excluded here exactly as it is absent from the §2 formula),
    `day_fraction is not null` (not a tombstone), and **not superseded** (the anti-join
    `not exists (… newer.superseded_by = ll.id)` — ADR 0009, identical to the cost
    engine). A correction's **current** row counts; the superseded row and tombstones do
    not.
  - **Rate — per current level, internal vs external.** Join the current
    `workers.level` (the **live** grade, not a snapshot — `labor_logs` carries no level
    column; a level-at-time snapshot is a later refinement, noted below) to
    `sell_rate_table`. The applicable column is **`internal_sell` unless the WP is
    external → `external_sell`**, where external =
    `coalesce((select is_external from wp_economics where work_package_id = p_wp), false)`
    (a WP with no `wp_economics` row is internal by default — U2 posture).
  - **Per-row value** = `(full → 1, half → 0.5) × sell_rate`; **sum** all rows;
    `coalesce(…, 0)` so a WP with no DC labor returns `0`, not NULL.
  - **Ungraded DC → 0 (never silently inflate).** A DC with `level IS NULL` has no
    `sell_rate_table` match, so the **inner join drops the row** → it contributes **0**.
    This is the deliberate safe posture: an ungraded DC cannot inflate profit. **Decision
    (the prompt's open point):** contribute 0, **no side-effect flag** — `wp_labor_sell`
    stays a pure read; _surfacing_ the count of ungraded-DC-days (so the operator grades
    them before settlement) belongs to the U3b profit struct / its UI, not this scalar.
  - **Gate — `super_admin` + `project_director` only** (the operator/exec who see WP
    economics; the HT P&L view is U3's surface, later). **No `project_manager`
    reference** → the ADR 0058 pgTAP 90/91 invariants are not triggered (deliberate, as
    in U1/U2 budget). The gate uses the **null-safe** `is distinct from` form (so a
    NULL-role service-role / unauthenticated caller is denied, not silently admitted —
    the `rls-self-check-coalesce` trap); any other role → `42501`. Existence-checked: an
    unknown WP → `P0001` (a typo'd id errors, never returns a misleading `0`).
  - **Reads zero-grant money tables** (`sell_rate_table`, `wp_economics`, `labor_logs`)
    — fine: SECURITY DEFINER bypasses RLS. **Invoked under the caller's authenticated
    session** (a real super/director JWT so `current_user_role()` resolves), never the
    admin client — exactly like `freeze_wp_labor_cost`. Execute is locked down:
    `revoke all … from public; grant execute … to authenticated` (anon can't reach it;
    authenticated still hits the internal gate). It is a read → **no audit row**, **no
    enum-add**.

### U3 TDD

**pgTAP** `101-wp-labor-sell.test.sql`: catalog (`wp_labor_sell(uuid)` exists; is
SECURITY DEFINER); the **gate** (super + director succeed; pm / site_admin / visitor →
`42501`); the **money math** — a graded crew on an **internal** WP sums at `internal_sell`
× fraction (senior full 800 + mid half 350 = **1150.00**); the **same crew on an external**
WP sums **higher** at `external_sell` (950 + 425 = **1375.00**, and `> ` the internal
total); an **edge** WP pins the exclusions in one number (ungraded DC → 0, an `own`
worker with a level → excluded, a superseded row excluded but its **current** correction
counted [junior half = 290], a tombstoned row excluded → **290.00**); an unknown WP →
`P0001`.

### U3 Scope — OUT (later units)

- **Full profit assembly** (`budget − equipment − labor_sell − materials`) + the
  equipment-rental ([spec 141/146](146-equipment-rental-money.md)) and materials
  (purchasing) wiring + the **GL reconciliation** (ADR 0057 — the P&L derives from / ties
  to the WP-dimensioned ledger, never a second costing path) — **U3b**.
- The **external-WP netting** against what we owe the subcontractor (ADR 0060 §2) —
  settlement territory, **U4+**.
- A **level-at-time snapshot** on `labor_logs` (sell uses the live grade for now) — a
  later refinement only if grade-at-time fairness is required.
- **Surfacing** the ungraded-DC-day flag, the HT's P&L view, banking profit at WP
  completion — **U3b / U5** + their UI.

## U3b detail — WP profit assembly (`wp_profit`), materials DERIVED FROM the GL

ADR 0060 §2: `WP profit = budget − (equipment rental + DC labor @ SELL + materials)`.
U3 built the labor-@-sell term; this unit **assembles the read** — budget − labor_sell −
materials − equipment — with **materials cost sourced from the WP-dimensioned GL**
(ADR 0057: derive from the ledger, **not a second costing path**), exposing every term so
the number is auditable. Still a pure **read**; nothing is banked (banking-at-completion =
later) and nothing is minted (settlement × multiplier = U4, blocked on utilization data).

**Equipment is a known gap (operator-confirmed 2026-06-20).** `post_rental_batch_to_gl`
posts a rental batch to WIP (1400) at **batch grain with no `work_package_id` (nor
`project_id`)** — equipment cost is **not WP-dimensioned in the GL**, so it cannot be
derived per-WP today. Making it per-WP needs a **business rule** for splitting a batch
across a project's WPs (a follow-up spec, touching the equipment poster / ADR 0055 — the
allocation basis is an operator decision). Per the scope rule, U3b does **not** improvise
it: the equipment term is **0 with a `equipment_costed = false` flag** so the omission is
loud and visible, never silently folded into a single profit number. (U4 minting is
blocked anyway, so no payout rides on the partial figure.)

- **`wp_profit(p_wp uuid) returns table(budget, labor_sell, materials_cost,
equipment_cost, equipment_costed, profit)`** — SECURITY DEFINER, `stable`, pinned
  `search_path`. One row of the profit components (all `numeric` except the boolean flag).
  - **budget** = `wp_economics.budget` for the WP (NULL until the PD sets it — U2).
  - **labor_sell** = `wp_labor_sell(p_wp)` — the U3 SSOT, **reused** (definer-to-definer:
    the original caller's role still resolves, so its identical super/director gate
    passes; no re-implementation of the sell math).
  - **materials_cost — from the GL, reversal-safe.** `Σ(debit − credit)` over
    `journal_lines` for this WP on the **WIP-construction account `1400`**, restricted to
    **purchase**-sourced entries: `coalesce(orig.source_table, e.source_table) =
'purchase_requests'` via `left join journal_entries orig on orig.id = e.reversal_of`. A
    reversal entry carries `source_table = 'journal_reversal'` but copies the line's
    `work_package_id` and swaps debit/credit — so attributing it through `reversal_of` to
    the original's source makes an **auto-corrected purchase net out** (the GL's own
    reverse-and-repost, `post_purchase_to_gl`). **Labor also debits 1400** but is excluded
    (its source is `wp_labor_costs`); **VAT (1300)** and **equipment (no WP dim)** are
    naturally excluded. This reads the ledger — it is **not** a re-sum of
    `purchase_requests` (the ADR 0057 invariant). Mirrors the `gl_trial_balance` join
    shape; no status filter (reversals net via debit/credit, as the trial balance does).
  - **equipment_cost** = `0`, **equipment_costed** = `false` (the flagged gap above).
  - **profit** = `budget − labor_sell − materials_cost − equipment_cost` — **NULL when
    budget is NULL** (no budget → no profit number; the components still return, so the
    caller sees _why_).
  - **Gate** — `super_admin` + `project_director` only, null-safe `is distinct from`
    (NULL-role denied), **no `project_manager` reference** (90/91 untouched) → `42501`;
    unknown WP → `P0001`. Execute lockdown `revoke all from public; grant execute to
authenticated`; invoked under the caller's authed session (like `wp_labor_sell` /
    freeze). Reads zero-grant money tables via the definer; a read → no audit, no enum.

### U3b TDD

**pgTAP** `102-wp-profit.test.sql`: catalog (`wp_profit(uuid)` exists; SECURITY DEFINER);
the **gate** (super + director read; pm / site_admin / visitor → `42501`); a fully-costed
WP (budget 5000, a senior DC full day = labor_sell 800, a purchase Dr-1400 net 1000, **plus
a labor Dr-1400 entry that must be excluded**) → `budget 5000 · labor_sell 800 ·
materials_cost 1000 · equipment_cost 0 · equipment_costed false · profit 3200`; a
**reversal-safe** WP (purchase 2000 → auto-correct reversal → re-post 1500) → `materials_cost
1500 · profit 2500`; a **budget-NULL** WP (no `wp_economics` row, a 300 purchase) →
`budget NULL · profit NULL`; an unknown WP → `P0001`. Journal rows are seeded directly
(an `accounting_periods` row + `journal_entries`/`journal_lines`), isolating the test from
the poster machinery.

### U3b Scope — OUT (later units)

- **Equipment cost per WP** — the batch→WP allocation rule + teaching
  `post_rental_batch_to_gl` to write `work_package_id` (its own follow-up spec; needs the
  operator's allocation basis). Until then `equipment_costed = false`.
- **Banking** the profit at WP completion (a stored, frozen figure) — settlement
  territory; **U4**.
- **Project settlement × the multiplier → the coin pool** — **U4** (blocked on
  utilization data for the markup-% / multiplier default).
- The **HT P&L surface** (the HT sees the real number) + any operator UI — later, with
  the unground-DC flag from U3.
