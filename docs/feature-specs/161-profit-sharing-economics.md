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

## U4a detail — the settlement multiplier dial (`nova_dials`)

ADR 0060 §3: at project close, `coin pool = Σ banked WP profits × the project
multiplier`. The multiplier is **"the most important undefined lever"** (open dials) —
calibrated to real utilization. Per the **build-time decision (a)** ("every dial lives in
an **editable table** seeded with a default; tune anytime"), this unit builds the
multiplier **as a seeded, editable dial** — not a hardcoded constant — so the settlement
engine (U4b) reads it and the operator tunes it live. **This unit is the dial only; the
settlement math reads it next (U4b)** — exactly as U1's sell-rate dials preceded the U3
read.

**One home for every economic dial.** Rather than a table per dial, build a small
**key/value `nova_dials`** table — the literal embodiment of decision (a). The arc's
remaining dials (HT cut %, level weights, saver-bonus rate — U5/U6) each land here as a
seeded row in their own unit; **U4a seeds only `coin_multiplier`** (scope: one dial).

- **Migration (additive):**
  - **`nova_dials`** — `dial_key text primary key`, `value numeric(20,4) not null`
    (`>= 0`), `updated_by uuid null`, `updated_at timestamptz`. **MONEY/economics
    posture** (a payout lever): RLS on, `revoke all` — **zero authenticated grant**; the
    operator reads via the admin client behind `requireRole`, the settlement engine (U4b)
    reads via the definer (the `sell_rate_table` posture).
  - **Seeded** `('coin_multiplier', 1.0)` — a **placeholder** default (1 baht banked
    profit → 1 coin point; coins are abstract points, no baht peg — ADR decision b). The
    operator **must calibrate it against real utilization before go-live** (the standing
    markup-% open dial; flagged, not blocking — the mechanism ships, the number is tuned).
  - **`set_nova_dial(p_key text, p_value numeric)`** — SECURITY DEFINER, **`super_admin`
    only** (operator economics — the anti-favoritism pillar §5, like the sell-rate dials;
    `is distinct from` null-safe → NULL-role denied; **no `project_manager` reference** →
    pgTAP 90/91 untouched) → else `42501`; `value >= 0` (P0001); the **key must already
    exist** (`update`-only — dials are a controlled, seeded set; a typo'd key → `P0001`,
    never a phantom dial); sets `value`, `updated_by = auth.uid()`, `updated_at = now()`;
    audits (generic `update` action, `target_table='nova_dials'`, payload key + old + new
    — no enum-add).

### U4a TDD

**pgTAP** `103-nova-dials.test.sql`: catalog (`nova_dials` table; `dial_key` PK; `value`
column; `set_nova_dial` is SECURITY DEFINER); **seed** (`coin_multiplier` present, value
`1.0`); **money posture** (authenticated has no SELECT); `set_nova_dial` — super updates
the multiplier (read back as owner) + audits, gate (pm / visitor → `42501`), an unknown
key → `P0001`, a negative value → `P0001`.

### U4a Scope — OUT (later units)

- The **settlement engine** — `Σ wp_profit` over a project's WPs × `coin_multiplier` →
  the coin pool, and **banking** profit at WP completion (a frozen snapshot) — **U4b**.
- The other dials (HT cut %, level weights — **U5**; saver-bonus rate — **U6**): each a
  seeded `nova_dials` row added by its unit.
- Posting the pool to `coin_postings` (the distribution) — **U5**.
- A per-project multiplier **override** (U4a is a single global dial) — a later
  refinement if "flex per project performance" needs it.
- A Nova **settings UI** to tune the dial — later (the operator can tune via the RPC /
  admin surface meanwhile).

## U4b detail — the settlement engine (`settle_project`)

ADR 0060 §3 (model-b): WPs **bank** their profit as they complete; the **whole project
settles once at close** → `coin_pool = Σ banked WP profits × coin_multiplier` (the U4a
dial). This unit builds that engine. It produces the pool **number** and a **frozen
snapshot**; the distribution of the pool to workers is U5.

**Decision — bank-at-settlement with a frozen per-WP snapshot (not a completion
trigger).** The prompt's recommendation was a trigger that snapshots a WP when it hits
`'complete'`. The hazard: a completion trigger fires under **whoever** updates the WP
status — usually a `site_admin` on the photo-approval path — and the figure must come
from `wp_profit`, which (with `wp_labor_sell`) is **gated to super_admin/project_director**
and raises `42501` for any other role. Banking-at-completion would therefore force an
ungated-internal refactor of the shipped U3/U3b functions and the whole WP-completion
transaction would fail for a site_admin. Instead `settle_project` is an **explicit
super/director action at close** that calls `wp_profit` **in exactly the caller context
it was designed for** (the gate passes), and **freezes** each completed WP's profit into
`wp_profit_bank` at that moment. This still meets the recommendation's stated goal —
**after settlement, corrections cannot silently move settled coins** because U5 reads the
frozen bank, never live `wp_profit`. Trade-off (accepted): a correction made between a
WP's completion and the project's close **is** reflected in the banked figure — which is
the correct behaviour (a legitimate pre-close correction should count), and defect-rework
before close is handled naturally (a WP back in `'rework'` is not `'complete'` → excluded;
a re-completed WP banks its fresh profit). The post-**close** defect clawback (design-rule
1 vesting tail) is U6b, not here.

- **Migration (additive):** `20260768000000_settlement_engine.sql` (sequenced **above**
  the spec 146 U3 equipment block `20260767*`, which landed concurrently and closed the
  equipment gap — so settlement now banks a `wp_profit` whose equipment term is **real**).
  - **`project_settlements`** — one row per project (the once-per-project record + the
    idempotency key): `project_id uuid primary key references projects(id) on delete
cascade`, `coin_multiplier numeric(20,4) not null` (the dial value frozen at
    settlement), `banked_profit_total numeric(20,4) not null` (Σ banked WP profit, baht),
    `coin_pool numeric(20,4) not null` (`banked_profit_total × coin_multiplier`, abstract
    points — ADR decision b, no baht peg), `wp_banked_count int not null`,
    `wp_skipped_null_budget_count int not null` (completed WPs **excluded** because budget
    is NULL — the explicit count, never silently 0), `equipment_costed boolean not null`
    (true only if **every** banked WP had `equipment_costed = true`; now **true** since
    spec 146 U3 folded `wp_equipment_sell` into `wp_profit` — the loud flag that _was_ the
    provisional-pool warning, kept forward-compatible if a WP ever reports uncosted
    equipment again), `settled_by uuid not null references users(id)`, `settled_at
timestamptz not null default now()`. **MONEY posture**: RLS on, `revoke all` — zero
    authenticated grant; the operator reads via the admin client, U5 reads via the definer.
  - **`wp_profit_bank`** — the frozen per-WP snapshot written at settlement (one row per
    banked WP): `id uuid pk`, `project_id`, `work_package_id` (unique with project_id),
    the six `wp_profit` components copied (`budget`, `labor_sell`, `materials_cost`,
    `equipment_cost`, `equipment_costed`, `profit`), `banked_at timestamptz`. **MONEY
    posture**: zero grant. This is the immutable record settled coins trace to.
  - **`settle_project(p_project uuid) returns table(coin_pool, banked_profit_total,
coin_multiplier, wp_banked_count, wp_skipped_null_budget_count, equipment_costed)`** —
    SECURITY DEFINER, pinned `search_path`. **`super_admin` + `project_director`** only,
    null-safe `is distinct from` (NULL-role denied — the rls-self-check-coalesce trap);
    **no `project_manager` reference** → ADR 0058 pgTAP 90/91 untouched → else `42501`. - project exists → `P0001`. - **closed only** — `status in ('completed', 'archived')` ("settles once **at
    close**") → else `P0001`. - **idempotent** — a pre-existing `project_settlements` row → `P0001` ("already
    settled"); settled coins are never re-minted. - reads `coin_multiplier` from `nova_dials` (the U4a dial). - loops the project's WPs with `status = 'complete'`; for each, `select * into … from
public.wp_profit(wp.id)` (the gate passes — caller is super/director): - **budget NULL ⇒ profit NULL ⇒ skip + count** (`wp_skipped_null_budget_count++`),
    never treated as 0. - else **freeze** a `wp_profit_bank` row, add `profit` to `banked_profit_total`,
    `wp_banked_count++`, AND the running `equipment_costed` with the row's flag. - `coin_pool = banked_profit_total × coin_multiplier`; inserts the `project_settlements`
    row; audits (generic `update` action, `target_table='project_settlements'`,
    `target_id = p_project`, payload = the totals — no enum-add); returns the summary. - Execute lockdown `revoke all from public; grant execute to authenticated`; invoked
    under the caller's authed session (like `wp_profit`).

### U4b TDD

**pgTAP** `104-settlement-engine.test.sql`: catalog (`project_settlements` table + PK;
`wp_profit_bank` table; `settle_project` is SECURITY DEFINER); **money posture**
(authenticated has no SELECT on either table); the **gate** (pm / site_admin / visitor →
`42501`); a closed project with WP-1 (budget 5000, a senior DC full day → labor_sell 800 →
profit 4200), WP-2 (budget 4000, no labor → profit 4000), WP-3 (complete, **no budget** →
skipped), WP-4 (`in_progress` → ignored) and `coin_multiplier` set to 2.0 → **super
settles** → `banked_profit_total 8200 · coin_pool 16400 · wp_banked_count 2 ·
wp_skipped_null_budget_count 1 · equipment_costed true` (no usage logs → equipment_cost 0,
but `wp_profit` flags it costed), and `wp_profit_bank` holds 2 frozen rows; a **director**
settles a second closed project (gate); **idempotency** — a
re-settle of the first project → `P0001`; a **non-closed** (`active`) project → `P0001`;
an unknown project → `P0001`.

### U4b Scope — OUT (later units)

- **Distribution** of the pool to workers (HT cut + level-weight split → `coin_postings`)
  — **U5**.
- **Equipment per WP** — **gap closed** by spec 146 U3 (`wp_equipment_sell` →
  `wp_profit`, landed concurrently); settlement banks the real equipment-inclusive
  profit. No longer an open item for this arc.
- A per-project multiplier **override** — U4b reads the single global U4a dial.
- An **un-settle** / re-open-settlement path — settlement is once-per-project; a
  correction after close is a break-glass operator action, not a routine RPC.
- The **operator UI** to trigger settlement + show the pool — later (the RPC is callable
  via the admin surface meanwhile).

## U5 detail — coin distribution (`distribute_project_coins`)

ADR 0060 §4: the **HT takes a cut off the top** (an editable %); the **rest splits by
level weight** among the DCs who worked the project (Senior→Apprentice; **internal >
external**; externals a flat, level-blind share — invisible-locked). This unit turns the
U4b **pool** into **postings** on the spec-160 coin ledger, **formulaically from measured
facts** (`labor_logs`) — the anti-favoritism pillar (§5): no subjective input anywhere.

**Gate — `super_admin` only.** Minting coins is peak operator authority — the same gate as
`post_coins` and `set_nova_dial`. This is deliberate (not super+director like settlement):
distribution **reuses the existing `post_coins` path** (ADR 0061 invariant 2/3, the
prompt's instruction), and `post_coins` is super-only; a definer-to-definer call resolves
the original caller's role, so a director calling it would hit `42501`. Computing the pool
(U4b) is super/director; **minting** it is super. Null-safe `is distinct from`; **no
`project_manager` reference** → ADR 0058 pgTAP 90/91 untouched → else `42501`.

**Internal vs external** = the worker's **tenure**: a DC whose `contractor` has
`contractor_subtype = 'dc_temporary'` is **external**; a null/other contractor is
**internal** (ADR 0060 §1 — the `dc_regular`/`dc_temporary` subtypes; a no-contractor DC
defaults internal, matching the `wp_economics.is_external` default-false posture). A
per-worker tenure column is a later refinement; for now it derives from the contractor.

- **New seeded dials (`nova_dials` rows — decision (a): editable, placeholder defaults):**
  `ht_cut_pct = 0.15`, `level_weight_senior = 4`, `level_weight_mid = 3`,
  `level_weight_junior = 2`, `level_weight_apprentice = 1`, `external_factor = 1` (the
  flat external weight per day — `< ` every internal level weight, so **internal >
  external**). **All placeholders — the operator must calibrate before go-live** (the
  fairness/aspiration tuning, ADR 0060 open dials). Seeded via the same `insert` posture as
  `coin_multiplier`; tuned via `set_nova_dial` (U4a, super-only).
- **Migration (additive):** `20260769000000_coin_distribution.sql`
  - **`project_coin_distributions`** — one row per distributed project (PK `project_id`
    references projects `on delete cascade` = the idempotency key): `coin_pool numeric`
    (snapshot from `project_settlements`), `ht_worker_id uuid null references workers(id)`,
    `ht_coins numeric not null`, `dc_distributed numeric not null` (Σ to non-HT DCs),
    `dc_count int not null`, `distributed_by uuid not null references users(id)`,
    `distributed_at timestamptz`. **MONEY posture**: RLS on, zero authenticated grant.
  - **`distribute_project_coins(p_project uuid) returns table(ht_coins, dc_distributed,
dc_count, total_distributed)`** — SECURITY DEFINER, pinned `search_path`. - super*admin gate (above). - project exists → `P0001`; **must be settled** — a `project_settlements` row exists →
    else `P0001` ("not settled"; U4b runs first); **idempotent** — a pre-existing
    `project_coin_distributions` row → `P0001` ("already distributed"); coins never
    double-minted. - reads `coin_pool` from `project_settlements`; the six dials from `nova_dials`
    (`coalesce(…, 0)`). - **HT cut** — `ht := projects.ht_worker_id`; `ht_coins := pool × ht_cut_pct`; if
    `ht` not null and `ht_coins > 0` → `post_coins(ht, 'profit_share', ht_coins, reason)`.
    (No HT assigned → `ht_coins = 0`, the full pool distributes to the DCs.) - **distributable** = `pool − ht_coins`. - **per-DC weight** — over each worker in **current** (non-superseded, non-tombstone)
    `labor_logs` with `worker_type_snapshot = 'dc'` on **any WP of the project**,
    **excluding the HT** (the HT's reward is the off-top cut — no double-dip):
    `days = Σ(full→1, half→0.5)`; `weight = (external ? external_factor :
level_weight[level]) × days`. An **ungraded internal DC** (`level NULL`) →
    `level_weight` NULL → weight **0** → **no share** (never silently inflated — the
    `wp_labor_sell` posture; surfacing ungraded-DC-days for the operator to grade before
    distribution is a UI concern). - each DC with `weight > 0`: `coins := distributable × weight / Σweight`; if
    `round(coins,4) > 0` → `post_coins(dc, 'profit_share', coins, reason)` (source
    `profit_share` — **already in the enum**, no enum-add); accumulate `dc_distributed`,
    `dc_count`. **A DC's share follows them across moves** — the weight reads
    `labor_logs` (where the work was \_done*), never `workers.project_id` (where they
    _are now_) — contribution is earned where made (§4). - inserts `project_coin_distributions`; audits (generic `update`,
    `target_table='project_coin_distributions'`, `target_id=p_project`); returns the
    summary. Execute lockdown like the other money RPCs.
  - **Externals — invisible + locked** (§4): U5 only **posts** the share; an external's
    coins are already **invisible** (coin reads are super-only / externals can't see them —
    spec 160 U3 posture) and their **spend lock** is enforced at redemption (U6b — an
    external's coins are not spendable until invited internal). No special posting flag here.

### U5 TDD

**pgTAP** `106-coin-distribution.test.sql`: catalog (`project_coin_distributions` table +
PK; `distribute_project_coins` is SECURITY DEFINER); **money posture** (authenticated has
no SELECT); the **gate** — super distributes; **project_director** / pm / visitor →
`42501` (super-**only**); **not-settled** project → `P0001`. With dials `ht_cut_pct 0.2`,
weights `senior 4 / mid 2`, `external_factor 2`, a settled project (`coin_pool 10000`) and
an HT (senior, with own labor) + a senior DC (1 day → w 4) + a **mid DC whose current
`project_id` is a DIFFERENT project** (1 day → w 2, proving share-follows-the-worker) + an
**external** DC (`dc_temporary`, 1 day → w `external_factor` 2) + an **ungraded** DC
(`level NULL`, 1 day → w 0) → **super distributes** → `coin_balance` HT `2000` (the cut
only — no double-dip), senior `4000`, mid `2000`, external `2000`, ungraded `0`; the
`project_coin_distributions` row has `ht_coins 2000` and `dc_distributed 8000`; **total
minted = pool 10000**; **idempotency** (re-distribute → `P0001`); unknown project →
`P0001`.

### U5 Scope — OUT (later units)

- The **Nova shop** (the coin sink), the **saver's bonus**, **vesting/confiscation** — **U6**.
- The **external invite → unlock** flow (turning an external internal unlocks their
  coins) — a later ecosystem step (ADR 0061 trajectory).
- A **per-WP** (vs per-project) distribution, or weighting by **WP profit** rather than
  labor-days — a later refinement; v1 splits the project pool by project-wide contribution.
- The **operator UI** for distribution + the worker-facing coin view — later (gift-first,
  ADR 0061; the RPC is callable via the admin surface meanwhile).

## U6a detail — Nova shop + per-item pricing + redemption

ADR 0060 §4: the coin **sink** is a Nova online shop. Per-item pricing in **coins**
(abstract points — decision b, **no baht peg**): each item's price is set independently.
This sub-unit builds the catalog + the **redemption** path (spending coins). The saver's
bonus + vesting/confiscation (the trust layer) are **U6b**.

- **Migrations (additive):**
  - `20260770000000_add_shop_redemption_coin_source.sql` — `alter type public.coin_source
add value if not exists 'shop_redemption'` (a redemption is a **spend** = a new
    posting category; its own migration, never used in the same tx it is added — the
    enum-add lesson). The earn-sources (`profit_share`/`savers_bonus`/`behavior_bonus`)
    stay; this is the **first sink** source.
  - `20260770000100_nova_shop.sql`: - **`shop_items`** — `id uuid pk`, `name text not null` (nonblank, ≤120),
    `description text null` (≤500), `price_coins numeric(20,4) not null` (`> 0`),
    `active boolean not null default true`, `sort_order int not null default 0`,
    `created_by`/`created_at`/`updated_by`/`updated_at`. The catalog is a **point**
    price list (not baht, not margin-sensitive) → RLS on, **SELECT granted to
    authenticated** (a future worker shop can read it; writes are RPC-only). - **`shop_redemptions`** — append-only spend record: `id uuid pk`, `worker_id`,
    `item_id`, `price_coins numeric(20,4) not null` (snapshot), `posting_id uuid not
null references coin_postings(id)` (the negative posting), `redeemed_by`,
    `redeemed_at`. RLS on, **zero write grant** (RPC-only), SELECT super-only (the
    coin_postings posture); **self-auditing** (the ledger + this row are the trail, like
    `post_coins` — no audit_log, no audit-action enum-add). - **`upsert_shop_item(p_name, p_price_coins, p_description default null, p_sort_order
default 0, p_id default null) returns uuid`** — SECURITY DEFINER, **super_admin only**
    (operator runs the shop), null-safe, no PM ref → `42501`; name nonblank +
    `price_coins > 0` → `P0001`; `p_id null` → insert (return new id), else update (not
    found → `P0001`); audits (generic `update`, `target_table='shop_items'`). - **`set_shop_item_active(p_id, p_active) returns void`** — super_admin, toggles
    `active` (unknown id → `P0001`); audits. - **`redeem_shop_item(p_worker, p_item) returns uuid`** — SECURITY DEFINER,
    **super_admin only** (operator-driven for now — worker self-redeem is later,
    gift-first). Worker exists + item exists & **active** → else `P0001`; `price :=
item.price_coins`; **balance check** — `coin_balance(p_worker) >= price` → else
    `P0001` ("insufficient balance"); **posts the spend** via `post_coins(p_worker,
'shop_redemption', -price, 'Shop redemption: '||name)` (negative posting — the
    existing path; `post_coins` allows non-zero negatives); inserts a `shop_redemptions`
    row (snapshot price + the `posting_id`); returns the redemption id. (U6b will narrow
    "balance" to **spendable** = vested + not-externally-locked.)

### U6a TDD

**pgTAP** `107-nova-shop.test.sql`: catalog (`shop_items`, `shop_redemptions`,
`redeem_shop_item` + `upsert_shop_item` SECURITY DEFINER; `coin_source` has
`shop_redemption`); `shop_items` SELECT granted to authenticated; `upsert_shop_item` — super
creates an item (read back) + updates it, pm / visitor → `42501`, zero price → `P0001`;
`redeem_shop_item` — a worker with **500 vested coins** redeems a **100**-coin item → balance
**400**, a `shop_redemptions` row + a `shop_redemption` −100 posting exist; pm → `42501`; an
**insufficient** balance (50 < 100) → `P0001`; an **inactive** item → `P0001`; unknown
worker / item → `P0001`.

### U6a Scope — OUT

- The **saver's bonus**, **vesting**, **confiscation/lock** — **U6b** (U6a redeem checks the
  full balance; U6b narrows it to spendable).
- The worker-facing shop UI + the operator shop-admin UI — later (the RPCs drive it).
- Stock/inventory limits, redemption fulfilment workflow, categories — later refinements.

## U6b detail — saver's bonus + vesting + narrow confiscation

ADR 0060 §6 + decision (c) + design-rules 1/6/7 + ADR 0061 trust invariant: **holding is
safe**. Vested coins (past the warranty/defect tail) are the worker's to keep,
**un-confiscatable**; confiscation is reserved for a **short, explicit gross-violation
list**; a **saver's bonus** rewards holding. This sub-unit builds those primitives on the
coin ledger.

- **Vesting model — time-based + the external lock.** No project link on `coin_postings`
  is added (keeps `post_coins` untouched); vesting derives from posting age:
  - `coin_unvested_balance(p_worker)` — for an **external** DC (contractor
    `dc_temporary`): the **whole balance** (externals are invisible-locked until invited
    internal — §4, generalized). For an **internal** DC: `least(balance, Σ positive earn
postings dated within the tail)` — recently-earned coins still inside the
    warranty/defect window (`vesting_tail_days` dial). These are the at-risk coins.
  - `coin_vested_balance(p_worker)` = `greatest(balance − unvested, 0)` — the worker's to
    keep. `coin_spendable_balance(p_worker)` = `coin_vested_balance` (so an external's
    spendable is 0 until invited; an internal can spend only vested coins). **`redeem_shop_item`
    is REPLACED** to check `coin_spendable_balance` instead of the raw balance — the lock
    becomes real (U6a built redeem on the full balance; U6b narrows it).
- **New seeded dials:** `vesting_tail_days = 365` (the post-close warranty tail — a
  placeholder; calibrate to the real defect-liability window), `savers_bonus_rate = 0.02`
  (2% — placeholder).
- **Narrow confiscation** (decision c — operator-confirmed list): a `confiscation_reason`
  **enum** = `('fraud', 'theft', 'gross_misconduct', 'defect_rework')` — the three gross
  violations + the **quality clawback** (design-rule 1: a defect-reopen claws back; same
  mechanism, distinct reason; **no catch-all `other`**, so confiscation can never be
  arbitrary). A new `confiscation` `coin_source` (its own enum-add migration — the second
  sink).
  - **`confiscate_coins(p_worker, p_reason confiscation_reason, p_note text)`** — SECURITY
    DEFINER, **super_admin only**, null-safe; confiscates **only the unvested** amount
    (`coin_unvested_balance`, capped at the current balance) — **vested coins are never
    touched** (the trust invariant); `unvested <= 0` → `P0001` ("no unvested coins to
    confiscate"; a fully-vested worker is safe). Posts a negative `confiscation` posting
    for that amount + records a `coin_confiscations` row (worker, reason, amount, note, by,
    at). The **defect-reopen → clawback** is realized via `p_reason='defect_rework'` (a
    defect within the warranty tail means the coins are still unvested → reachable); the
    **auto-wiring** into spec-144's reopen RPC is flagged below (needs a per-project link on
    coin_postings — its own follow-up).
- **Saver's bonus** — **`award_savers_bonus(p_worker) returns numeric`** — SECURITY
  DEFINER, **super_admin only**. `bonus_rate := savers_bonus_rate`; `bal :=
coin_balance(p_worker)` (≤ 0 → `P0001`); **holding-discipline guard** — no
  `shop_redemption` posting since the worker's most recent `savers_bonus` posting (spent
  since the last bonus → `P0001` "spent since last bonus", so the bonus rewards _continued_
  holding, not churn); `bonus := round(bal × bonus_rate, 4)`; posts `savers_bonus` (already
  in the enum). Cadence is operator-driven (call per cycle); the rate is the dial.

### U6b TDD

**pgTAP** `108-nova-vesting.test.sql`: catalog (`coin_unvested_balance` /
`coin_vested_balance` / `coin_spendable_balance` / `confiscate_coins` /
`award_savers_bonus`; `confiscation_reason` enum labels; `coin_source` has `confiscation`;
`coin_confiscations` table); **vesting** — an internal DC with an **old** +1000 posting
(past the tail) + a **recent** +500 → `unvested 500`, `vested 1000`, `spendable 1000`; an
**external** DC with +800 (any age) → `unvested 800`, `vested 0`, `spendable 0` (locked);
**redeem respects the lock** — the external cannot redeem (spendable 0 → `P0001`), the
internal can spend only the vested 1000; **confiscation** — `confiscate_coins(internal,
'fraud')` removes the **500 unvested** only (balance → 1000, the vested kept), a
fully-vested worker → `P0001`, pm → `42501`; **saver's bonus** — `award_savers_bonus`
mints `bal × rate`, a worker who **redeemed since their last bonus** → `P0001`.

### U6b Scope — OUT

- The **per-project defect clawback auto-wiring** (spec-144 reopen → claw back _that
  project's_ unvested profit_share) — needs a project link on `coin_postings` (an additive
  column + `post_coins` extension; touches shipped spec-160 code) → its **own follow-up
  unit**. U6b ships the time-based vesting + the `defect_rework` confiscation reason (the
  manual clawback mechanism); the automatic trigger is the seam.
- The **external invite → unlock** event (flipping a DC internal vests their locked coins)
  — a later ecosystem step (ADR 0061 trajectory).
- The **attrition-signal** spend-watchlist (§6) — a later analytics layer (soft, never an
  automated penalty).
- The worker-facing "saved / vested / locked" display + the operator confiscation UI —
  later (the RPCs drive them).

## Operator UIs (U7–U9) — making the engine operable

The U1–U6b RPCs are SQL-only. These units add the super_admin surfaces (under
`/nova`) that drive them, so the operator can run + calibrate the engine without
SQL. Each page reads the zero-grant economics tables via the **admin client**
behind `requireRole(["super_admin"])`, and writes via server actions that relay to
the SECURITY DEFINER RPCs through the **RLS server client** (the user JWT — the
setter gates read `current_user_role()`, which the service-role client lacks).
Pages are auth-gated, so verification is the component test + checklist (spec 162
precedent), not e2e.

- **U7 — dials calibration console (`/nova/dials`).** Read `nova_dials` +
  `sell_rate_table`; tune every seeded placeholder (`coin_multiplier`, `ht_cut_pct`,
  the four `level_weight_*`, `external_factor`, `vesting_tail_days`,
  `savers_bonus_rate`, and the per-level sell rates) via `setNovaDial` / `setSellRate`.
  The go-live calibration surface. `NovaDialsForm` + `nova-dials-form.test.tsx`.
- **U8 — settlement + distribution flow.** Pick a closed project → `settle_project`
  (show the pool + the per-WP bank) → `distribute_project_coins` (show the HT cut +
  the DC split). The operational lifecycle at project close.
- **U9 — Nova shop admin (`/nova/shop`).** List `shop_items`; create/edit
  (`upsert_shop_item`) + toggle availability (`set_shop_item_active`). The catalog
  behind the coin sink.

Worker-facing surfaces (the gift bundle, the vested/locked view) stay later
(gift-first, ADR 0061).
