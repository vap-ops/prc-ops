# Spec 100 — ภาพรวม / Dashboard (role-aware overview)

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = operator phone).
**Driver:** operator picked "ภาพรวม / Dashboard" for "what next" — graduates the spec-98 coming-soon
placeholder into a live screen.

## Why

The nav advertised ภาพรวม as coming-soon (spec 98). Build it: a portfolio overview of live projects.
Budget data exists (`projects.budget_amount_thb`, specs 79–80) but was never surfaced.

## Decision (operator call)

**Role-aware** (operator choice over PM-only / SA-money-exception): every staff role sees a
**money-free operational overview**; PM/super additionally see **budget vs spend** (money). This keeps
ภาพรวม on every bar (SA included — the operator's account) while honoring the hard rule that
site_admin never sees money (budget/cost have zero authenticated grant; money is admin-read behind a
PM gate).

## Money model (from the map-then-spec investigation)

- **Budget** = `projects.budget_amount_thb` (project-level only; nullable; admin-read, PM/super).
- **Spend** per project = **labor** (`aggregateLaborCost` over `labor_logs` for the project's WPs,
  own+dc) + **materials** (Σ `purchase_requests.amount` where `status ∈ {purchased, on_route,
delivered, site_purchased}` and amount is not null). All money read via the admin client behind
  `requireRole(PM_ROLES)`.
- **Honest caveat:** PR `amount` is often null (site-staff PRs / site purchases don't record a price),
  so material spend is **partial**. The UI says so (`ค่าวัสดุนับเฉพาะที่บันทึกราคา`).

## What ships

- **`src/lib/dashboard/overview.ts`** (pure) — `rollupProgress(wps)` → `{ total, complete,
pctComplete, needsAttention }`; needsAttention = WPs with status `on_hold` or `pending_approval`.
- **`src/lib/dashboard/spend.ts`** (pure) — `SPEND_STATUSES`; `sumMaterials(prs)` (status-gated,
  null-safe); `budgetStatus(budget, spend)` → `{ hasBudget, budget, spend, remaining, pctUsed, over }`.
- **`app/dashboard/page.tsx`** — `requireRole(SITE_STAFF_ROLES)`; a hub-style screen (BottomTabBar +
  plain header, NO DetailHeader — it's a primary tab, like /settings). Operational reads on the user
  session (projects / work_packages / purchase_requests statuses, all SA-readable); if the role is in
  `PM_ROLES`, an admin-client pass adds budget + labor cost + PR amounts and renders the money section
  (portfolio total + a budget-vs-spend bar per project). Live projects only (status active/on_hold).
- **Nav graduation** — `ภาพรวม` flips from coming-soon to a real tab/hub item (href `/dashboard`) in
  `bottom-tab-bar.tsx` + `hub-nav.tsx` (SA + PM). Since it was the only top-level coming-soon item, the
  bottom-bar/hub `comingSoon` mechanism is **retired** (flag + Clock marker + match-loop skip removed
  — no dead/untested code). The coming-soon concept lives on in the ตั้งค่า rows (Nova, คลังเอกสาร) via
  `ComingSoonBadge`, unchanged.

## Tests

- `dashboard-overview.test.ts` + `dashboard-spend.test.ts` (TDD, RED→GREEN) — progress rollup +
  rounding + attention; material sum status-gating + null-safety; budget status (no-budget / under /
  over).
- `bottom-tab-bar.test.tsx` + `hub-nav.test.tsx` — updated: ภาพรวม is now a normal link that lights on
  `/dashboard`; coming-soon-placeholder cases removed (mechanism retired).
- `nav-back-affordance.test.ts` — `/dashboard` added to NON_DETAIL (a primary-tab hub, no back chip).
- The page = verified-by-checklist (Server Component; pure helpers carry the logic tests).

## Seams (recorded)

- Material spend is partial until PR amounts are captured consistently (UI discloses it).
- Per-WP budget doesn't exist — comparison is project-level only.
- Labor spend uses live `labor_logs` (not the frozen `wp_labor_costs`) so it reflects current days.
- Archived/completed projects hidden (live only); a filter/toggle is a later refinement.
- Desktop HubNav strip not rendered on /dashboard (mirrors /settings); add if wanted.
