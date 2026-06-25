# 205 — WP labor budget (งบค่าแรงต่อรายการงาน)

Status: U1 SHIPPED (2026-06-25, migs 20260813002200 + harden 20260813002300, pgTAP 226 21/21) · U2 SHIPPED (2026-06-25, code-only, budget-vs-actual card on the PM review ค่าแรง section) · U3 SHIPPED (2026-06-26, code-only, budget on the WP detail จัดการ tab — discoverability fix).
Relates: ADR 0060 (WP economic identity / `wp_economics`), ADR 0058 (project_director
ride-along), spec 68 (labor cost + freeze), spec 161 (`set_wp_budget`/`set_wp_external`).

## Why

Operator directive: **"Each WP will have its own labor budget which will be set by
either PM or PD."**

Today a WP carries a frozen **actual** labor cost (`wp_labor_costs`, own+dc, spec 68)
surfaced in the `ค่าแรง` section of the PM review page — but there is no **target** to
measure it against. The PM running the crew has no per-WP labor cost ceiling, so labor
spend can only be read after the fact, never managed against a plan.

This adds a per-WP **labor budget**: a money (baht) cost ceiling for labor, set by the
PM **or** the PD, displayed as budget-vs-actual next to the live labor cost.

### Decisions (no new ADR — extends ADR 0060)

- **Money, not man-days.** The whole labor/profit stack is baht-denominated
  (`day_rate_snapshot`, `wp_labor_costs.own_cost/dc_cost`, `wp_profit`,
  `budgetStatus`). A man-day budget would have nothing in the cost model to compare
  against; a baht budget compares directly to `aggregateLaborCost(...).total`.
- **Distinct from `wp_economics.budget`.** The existing `budget` (ADR 0060 §1) is the
  WP's **revenue/profit denominator**, PD-only. The labor budget is a **cost-side
  sub-budget** for labor specifically — a different number with a different owner, so
  it gets its own column and its own setter. It is **not** subtracted from anything in
  `wp_profit` (that formula is unchanged); it is purely a planning target for the
  labor cost line.
- **Single total**, not an own/dc split. The directive says "its own labor budget"
  (singular). Actual cost is still shown split own/dc by `LaborCostView`; the budget
  compares against the grand total.
- **Lives on `wp_economics`** (one row per WP, zero-grant MONEY table) — DRY with the
  existing `budget`/`is_external` columns and their upsert+audit setters.
- **Gate = PM or PD** (`project_manager`, `project_director`, `super_admin`). This
  deliberately **widens** beyond `set_wp_budget` (PD-only) — the PM owns day-to-day
  crew cost. Because the gate names `project_manager`, ADR 0058 / pgTAP 90 require
  `project_director` to ride along; it does. Mirrors `set_wp_external` exactly.

## U1 — data layer (`set_wp_labor_budget`)

Additive migration (nullable column + new function) → auto-pushable per the standing
backlog grant.

- **Migration** `supabase/migrations/20260813002200_spec205u1_wp_labor_budget.sql`:
  - `alter table public.wp_economics add column labor_budget numeric(20,4) null;`
  - `alter table public.wp_economics add constraint wp_economics_labor_budget_nonnegative
check (labor_budget is null or labor_budget >= 0);`
  - `create function public.set_wp_labor_budget(p_wp uuid, p_budget numeric)` —
    `security definer`, `set search_path = public`. Gate
    `current_user_role() not in ('project_manager','project_director','super_admin')`
    → `42501`. Null/negative → `P0001`. Unknown WP → `P0001`. Upsert one row per WP
    **preserving** `budget`/`is_external`. Audit `('update', …, 'wp_economics', p_wp,
{field:'labor_budget', value:p_budget})`. `revoke all from public; grant execute
to authenticated`. Mirror `set_wp_external`.
  - Update the `wp_economics` table comment to name `labor_budget`.
- **Server action** `setWpLaborBudget` in `src/lib/labor/actions.ts` (mirror
  `refreezeWpLaborCost`): validate UUID + revalidate path + non-negative finite
  number; gate the authed session on `PM_ROLES`; call `set_wp_labor_budget` on the
  **user** supabase client (not admin); map errors to a Thai generic; `revalidatePath`.
- **pgTAP** `supabase/tests/database/226-wp-labor-budget.test.sql` — mirror file 99:
  column exists + check constraint present; PM sets; PD rides along; super re-sets
  (upsert); site_admin denied (`42501`); visitor denied (`42501`); unknown WP
  (`P0001`); negative (`P0001`); upsert preserved a pre-set `budget`/`is_external`;
  the successful sets were audited (`field='labor_budget'`).
- Run `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (226 green; 90 still green —
  the new RPC names project_director so the completeness catalog passes).

## U2 — budget-vs-actual UI

Code-only.

- **Pure** `src/lib/labor/budget.ts` — `laborBudgetSummary(budget, spend)`,
  **purpose-built** (NOT a `budgetStatus` wrapper: `budgetStatus` collapses 0 into
  "no budget", but U1 stores `labor_budget` 0 ≠ NULL on purpose, so the card must tell
  set-zero from unset). Returns `isSet` (budget !== null), `remaining`, `pctUsed`
  (floored — never shows 100% while under budget; null when budget 0 with spend),
  `over`, and a `tone` (`over` → danger, floored `pctUsed >= 90` → attn, else ok).
  Unit-tested incl. both 0-budget cases + the fractional near-budget / 90% boundary.
- **Read** `wp_economics.labor_budget` via the admin client on
  `/review/work-packages/[workPackageId]` (the page is already
  `requireRole(PM_ROLES)` + admin-client money reads).
- **UI** in the `ค่าแรง` section: a `LaborBudgetCard` showing งบค่าแรง (budget) ·
  ใช้ไป (actual `costSummary.total`) · คงเหลือ/เกินงบ (remaining/over) · % used, with
  an inline **set/edit** control (`LaborBudgetControl`, client) that calls
  `setWpLaborBudget`. Render the editor for PM/PD/super (all reach this page). When no
  budget is set, show a "ตั้งงบค่าแรง" prompt. The section's existing render gate
  widens so it also shows when a labor budget exists (not only when there's cost).
- Screenshot the budget-vs-actual card → Telegram ✅.

## U3 — surface on the everyday WP detail page (discoverability)

Code-only. After U2 shipped, the operator (super_admin) couldn't find the control:
U2 put it only on `/review/work-packages/[id]`, which is linked **solely** from the
รอตรวจ queue ([review/page.tsx](../../src/app/review/page.tsx) lists only
`pending_approval` WPs). With nothing pending review there's no link at all — and a
budget is not something you'd look for in an approval queue. So the control is now
also on the everyday WP detail page (`/projects/[id]/work-packages/[id]`).

- New `src/lib/labor/wp-budget-summary.ts` — `fetchWpLaborBudgetSummary(wpId)`:
  server-only, admin-client read of `labor_logs` (cost) + `wp_economics.labor_budget`
  → `laborBudgetSummary`. Extracted from the review page's inline reads; callers MUST
  gate on `isManagerRole`.
- WP detail page: a 9th entry in the existing `Promise.all` (no waterfall) —
  `isPlanner ? fetchWpLaborBudgetSummary(workPackageId) : Promise.resolve(null)`. The
  `จัดการ` tab (already pushed only `if (isPlanner)`, i.e. PM/PD/super) renders the
  `LaborBudgetCard` at its top. site_admin/procurement never run the read, never see
  the tab → money stays off field/read-only sessions.
- Kept on the review page too (both surfaces). Card/control/RPC unchanged from U1/U2.

## Out of scope

- Feeding the labor budget into `wp_profit` / over-budget into approvals/alerts
  (planning display only this spec).
- own/dc split budgets; project-roll-up of labor budgets; budget history/versioning.
- Surfacing on the SA field page (money stays PM-tier).
- Setting a labor budget at WP creation (set/edit anytime from the WP detail
  จัดการ tab or the review page — U3).

## Verification

- `pnpm db:test` → 226 green, 90 green.
- `tests/unit/labor-budget.test.ts` green (`laborBudgetSummary` incl. the over case).
- `pnpm lint && pnpm typecheck && pnpm test` green.
- Preview `/review/work-packages/[id]`: ค่าแรง section shows the budget card; PM/PD can
  set + edit; over-budget renders the danger tone. Screenshot → Telegram.
