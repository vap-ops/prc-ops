# Spec 261 — `procurement_manager` role (หัวหน้าจัดซื้อ)

**Status:** DRAFT (2026-07-04) — requires **ADR 0070** (role-enum addition;
CLAUDE.md: no enum change without an ADR). Build order: independent of spec
260, but 260's `void_purchase_order_charge` gate expects this role to be
appended once it lands — ship 260 first, then this, then widen.
**Origin:** Procurement team asked for a "manager user"; the operator then
set the first concrete rule: **cancelling a PO is manager-only**. Today the
single `procurement` role is flat — it can raise PRs, create POs, void POs
(spec 259 gave the whole create-audience void), receive goods and pay DC
payroll, with no senior/junior distinction and no dept-level master-data
authority.

## Why a new enum value (and not a flag or the PM tier)

- `users` has no flag columns and the entire gate infrastructure — TS
  allowlists in `src/lib/auth/role-home.ts`, SQL `current_user_role()` checks
  in RLS policies and DEFINER RPCs — keys on the single `users.role` enum.
  The role is resolved **live from `public.users` on every request**
  (`loadUserContext` in `require-role.ts`, per-request React `cache()` memo;
  the middleware only verifies the session and never reads role, and no JWT
  claim carries it) — so a new enum value flows through automatically with
  zero middleware or cache work. A boolean flag, by contrast, would need a
  parallel gate channel in every TS allowlist and SQL helper.
- The existing "manager" tier (`PM_ROLES` = project_manager / super_admin /
  project_director, SQL `is_manager()`) is **project-side seniority**, not
  procurement-dept seniority — overloading it would hand every PM all
  procurement master-data powers. Wrong shape.
- ADR 0070 records this: one new enum value `procurement_manager`, a
  superset-of-`procurement` dept role, plus the doctrine that dept-manager
  roles are enum values, not flags (next dept that needs one follows this
  precedent).

## Capability model

`procurement_manager` = **everything `procurement` can do, plus the
manager-only set.** The sweep must distinguish the **three distinct gate
mechanisms** (naming them wrong sends the implementer to the wrong file):

1. **SQL shared helpers** — `is_back_office()`
   (`20260813051000_rls_null_safe_role_wrappers.sql`) gates a large batch of
   DEFINER RPCs (DC payroll, workers, supply plans, catalog, contacts bank…).
   Adding `procurement_manager` **inside this one helper** achieves parity
   for that whole surface at once. Per-RPC/per-policy gates that name
   `'procurement'` literally get the value appended individually.
2. **TS page/action allowlists** — the exported constants in `role-home.ts`
   (`BACK_OFFICE_ROLES`, `SUPPLY_PLAN_ROLES`, `PAYROLL_VIEW_ROLES`, …): every
   constant containing `'procurement'` gains `'procurement_manager'`, plus
   `roleHome('procurement_manager') → /requests` (roleHome lives in
   `role-home.ts` and is called from `require-role.ts` + the LINE callback —
   NOT middleware; no middleware change exists or is needed).
3. **Menu visibility** — `sections.ts`'s local `isBackOffice` predicate
   (settings-hub cards only; visibility, not enforcement).

pgTAP must assert parity across mechanism 1 (see checklist) so no policy is
missed — zero-unsafe-gates invariant, RLS audit 2026-07.

### Manager-only set (v1)

| # | Capability | Change |
| - | ---------- | ------ |
| 1 | **Void PO** (operator directive) | `void_purchase_order` gate TIGHTENS: `procurement` is **removed**, `procurement_manager` added → final gate `project_manager \| project_director \| super_admin \| procurement_manager`. UI button follows. This deliberately walks back half of spec 259's grant nine days after shipping it — the operator's explicit call. |
| 2 | **Void PO charge** (spec 260) | append `procurement_manager` to `void_purchase_order_charge`'s manager gate |
| 3 | **Cancel an approved PR** | today manager-tier via RLS UPDATE policy + `isDecider` UI; append `procurement_manager` to both |
| 4 | **Supplier blacklist / unblacklist** | contacts blacklist status flip gains the dept manager; plain procurement keeps read + ordinary supplier edits |

### Deferred, NOT v1: master-data narrowing (templates + catalog taxonomy)

The natural manager asks #5 (ordering-plan template editing,
`/settings/ordering-templates`) and #6 (catalog taxonomy write side) are
**recorded but deferred**, because both collide with shared gates:

- The templates editor has **no template-specific RPC** — it reuses the SAME
  supply-plan write RPCs the project plan grid uses
  (`add_supply_plan_lines`/`remove_supply_plan_line`, gated
  `is_back_office()`; page gate `SUPPLY_PLAN_ROLES`). Narrowing at the RPC
  level would strip plain procurement's ability to edit real project supply
  plans (spec 181 flow) — a regression.
- Catalog taxonomy RPCs sit on the same shared `is_back_office()` helper as
  DC payroll / workers / supply plans, which must KEEP admitting plain
  procurement. Narrowing taxonomy means **forking those specific RPCs onto a
  bespoke manager gate** — real work, its own follow-up unit.

Deferral keeps this spec purely additive (parity widening + the four-item
manager set). The narrowing unit, if the operator wants it, forks the
catalog-taxonomy RPCs + adds a template-specific write path, sized on its
own. 🔔 In the decision list.

### Explicitly NOT granted (v1)

- **PR approval** (`requested → approved/rejected`) stays PM-tier only.
  Spend authorization is project-side control; the procurement manager runs
  buying execution. 🔔 flagged as an open operator question in the decision
  list — if granted later it is a one-line RLS + `isDecider` widening, its
  own mini-spec.
- **Supply-plan approval** stays PD/super (`approve_supply_plan`) — the
  "procurement never approves its own plan" doctrine is untouched.
- Any accounting surface (`/accounting/*`, GL RPCs) — unchanged.

## Migration + code sweep

1. Migration A (additive): `ALTER TYPE ... ADD VALUE 'procurement_manager'`
   (own transaction — Postgres requires enum ADD VALUE committed before use).
2. Migration B: re-CREATE (DROP+CREATE, sourced from LIVE per
   db-migration-lessons) every DEFINER RPC and RLS policy whose gate changes:
   the parity sweep (widen `is_back_office()` + append alongside literal
   `'procurement'` gates) + the four-item manager set above (incl. the spec
   259 tighten). Grep pins in pgTAP so a future CREATE-OR-REPLACE can't
   silently drop an arm.
3. TS sweep: `role-home.ts` (constants + `roleHome`), `sections.ts`,
   `isDecider` sites, action gates. (No middleware or cache work — role is
   read live per request, see "Why a new enum value".)
4. `labels.ts`: `USER_ROLE_LABEL` entry หัวหน้าจัดซื้อ — **load-bearing**:
   the user-admin role picker renders `Object.entries(USER_ROLE_LABEL)`
   (`role-admin-list.tsx`), so the promotion option only appears once this
   entry exists. The `set_user_role` RPC takes the enum type directly — no
   RPC change.
5. Promotion path: super_admin promotes via the existing user-admin surface
   (picker option from step 4).

## Out of scope

- Approval thresholds / amount limits (no threshold concept exists anywhere;
  a real feature, own spec if ever asked).
- Delegation, multi-dept manager framework, org chart.
- By-purchaser report visibility — spec 262 owns that gate and will admit
  `procurement_manager` (+ manager tier) when it builds.

## Verification checklist

- pgTAP **parity sweep**: for every RLS policy and DEFINER RPC that admits
  `procurement`, assert it also admits `procurement_manager` (write the test
  as a catalog query over `pg_policies` + `pg_proc` source scan where
  practical, plus explicit per-surface asserts for the money paths:
  `create_purchase_order`, `record_purchase`, receive/divert RPCs, DC payroll
  pay).
- pgTAP manager-only set: `void_purchase_order` REFUSES plain `procurement`
  (regression flip of spec 259's test) and allows `procurement_manager`;
  same-shape asserts for items 2–4.
- pgTAP: role enum contains the value; `roleHome` unit test routes it to
  `/requests`; visitor/site_admin still refused everywhere they were.
- `pnpm lint && pnpm typecheck && pnpm test`; real-browser: promote a test
  user, walk /requests (full procurement surface visible), void button
  present; demote to plain procurement, void button gone.
