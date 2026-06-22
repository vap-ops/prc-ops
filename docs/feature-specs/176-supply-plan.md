# Spec 176 — Supply Plan (the PM-accuracy engine)

## Why

The operator's purpose for the on-site store (see `docs/inventory-store/README.md`, spec 175):
measure **PM planning accuracy**. A PM bulk-plans the materials a project needs — quantities of
catalog items, allocated per work package — up front. That plan becomes a **frozen baseline**.
Later, what was actually ordered / issued / bought-reactively is compared against it: did the PM
plan the right items in the right quantities for the right WPs? "If the PM plans perfectly, the
site admin never has to scramble-order." This spec builds that planning + measurement engine.

It sits on the **item catalog** (spec 175) — plan lines reference catalog items, so plan → order
→ issue → consumption can be matched (the whole reason the catalog exists).

## The arc (multi-unit)

- **U1 — data foundation** (this unit): `supply_plans` + `supply_plan_lines` tables + the
  `create_supply_plan` / `add_supply_plan_line` RPCs.
- **U2 — planning UI**: PM opens a project's plan, adds lines (catalog item picker + WP + qty),
  edits/removes draft lines.
- **U3 — submit + PD approve/reject**: freezes the plan (the immutable baseline).
- **U4 — reactive-PR reason codes**: tag each reactive purchase (`unplanned-miss` dings the PM;
  rework / breakage / scope-change / unforeseeable don't).
- **U5 — measurement**: planned vs issued vs reactive, per project / per WP / per PM.

## U1 — data foundation

### Data model

- New enum `supply_plan_status` — `draft` → `submitted` → `approved` / `rejected`.
- `supply_plans`: `id`, `project_id` (FK projects, **unique — one plan per project**), `status`
  (default `draft`), `note`, `created_by` (`default auth.uid()`), `created_at`, `submitted_at`,
  `approved_by`, `approved_at`.
- `supply_plan_lines`: `id`, `supply_plan_id` (FK, cascade), `catalog_item_id` (FK catalog_items),
  `work_package_id` (FK work_packages, **nullable = site-general**), `qty numeric(12,2)` (CHECK > 0),
  `note`, `created_at`. **Unique** `(supply_plan_id, catalog_item_id, coalesce(work_package_id, <sentinel>))`
  — one allocation per item per WP (null WP collapses to a sentinel so a site-general line is unique).
- **RLS**: both tables READ via `can_see_project` (ADR 0056 — super/director/coordinator see all;
  PM/SA by membership). **No write policy** — the SECURITY DEFINER RPCs are the sole write path
  (the catalog / deliverables posture).

### RPCs (planner tier = PM / super_admin / project_director)

- `create_supply_plan(project_id) returns uuid` — **get-or-create** a project's plan (returns the
  existing one if present). Role gate + `can_see_project` membership + project-exists (`22023`).
- `add_supply_plan_line(plan_id, catalog_item_id, work_package_id, qty, note) returns uuid` — adds
  a line to a **draft** plan (a submitted/approved plan is frozen → `22023`). Validates: qty > 0,
  catalog item exists + `is_active`, the WP (if given) belongs to the plan's project; duplicate
  `(item, WP)` → `23505`. All `22023`/`42501` mapped for the UI later.

### Tests

pgTAP `176-supply-plan` (19): tables + RLS, RPCs exist + anon-deny; create is idempotent; add
returns id; qty≤0 / WP-other-project / inactive-item / duplicate / frozen-plan all rejected;
non-member PM + visitor denied; super on unknown project → 22023.

## U2 — planning screen

The PM-facing screen at `/projects/[projectId]/supply-plan` (planner tier; RLS scopes the
project read to members → a non-member PM gets `notFound`). Reached from a `ClipboardList` chip
on the project header (manager-only).

- **`remove_supply_plan_line(line)` RPC** (migration `20260806`) — draft-only delete, planner +
  member; unknown line / frozen plan → `22023`; the table has no DELETE grant.
- **`SupplyPlanManager`** (client): a status chip; "เพิ่มรายการแผน" → BottomSheet form (catalog
  item `<select>` grouped by category with `<optgroup>`, WP `<select>` — **required in U2**, qty,
  note) → `addPlanLine`; per-line remove (`Trash2`) → `removePlanLine`. A submitted/approved plan
  renders **read-only** (no add/remove).
- **Actions** (`addPlanLine` / `removePlanLine`): `getActionUser` + the RPCs; add does
  get-or-create (`create_supply_plan`) then `add_supply_plan_line`; maps `23505`/`42501`/`22023`;
  `revalidatePath`.
- **Page** loads the plan + its lines (joined to catalog item + WP) + the pickers (active catalog
  items + the project's WPs).
- **Tests:** `supply-plan-manager.test.tsx` (4: submit-gating, add with item/WP/qty, remove,
  frozen read-only); pgTAP `177-supply-plan-remove-line` (9).
- **Note:** site-general (null WP) is schema-supported, but the U2 form **requires a WP** (the core
  qty-per-WP case) — a "ทั้งโครงการ" picker option is a later add.

## U3 — submit + PD approve/reject (freeze the baseline)

Lifecycle: `draft → (PM submit) → submitted → (PD approve) → approved [frozen]` /
`→ (PD reject) → rejected → (PM revises + resubmits)`. **Separation of duties:** the planner
tier submits; only the approver tier (`project_director` / `super_admin`) approves or rejects —
a plain PM cannot approve its own plan.

- **Migration `20260807`:** `submit_supply_plan` (planner; `draft|rejected → submitted`),
  `approve_supply_plan` + `reject_supply_plan` (PD/super only; `submitted → approved|rejected`).
  CREATE OR REPLACE `add_supply_plan_line` + `remove_supply_plan_line` to widen editability
  `draft → draft|rejected` (a rejected plan is revisable). All anon-revoked.
- **`SupplyPlanManager`:** `editable` now includes `rejected`; header shows **ส่งอนุมัติ**
  (planner, draft/rejected) · **อนุมัติ / ตีกลับ** (approver, submitted) · **รออนุมัติ**
  (non-approver, submitted). Page passes `planId` + `canApprove` (PD/super).
- **Actions:** `submitPlan` / `approvePlan` / `rejectPlan`.
- **Tests:** `supply-plan-manager.test.tsx` (+3 lifecycle); pgTAP `178-supply-plan-lifecycle` (17).

## U4 — reactive-PR reason codes (tag every purchase request)

Every purchase request is a **reactive** order relative to the frozen supply plan — it was
either not planned, or planned but is being re-bought. U4 makes the requester say **why** the
item wasn't simply drawn from the plan/store, so U5 can separate "the PM should have planned
this" (`unplanned_miss`) from fair reactive reasons.

**Operator-locked decisions (2026-06-22):**

1. **Taxonomy (5 codes), confirmed.** Enum `purchase_request_reason_code` —
   `unplanned_miss` (PM should have planned it — **the only code that counts against the PM**),
   `rework`, `breakage`, `scope_change`, `unforeseeable`.
2. **Required on every PR.** Both create paths require a reason; there is no honest default.
3. **Both create paths.** The formal `/requests` purchase-request form (`createPurchaseRequest`)
   **and** the WP-detail on-site quick-record (`record_site_purchase`).

### Data model

- New enum `purchase_request_reason_code` (the five values above; mirrors the
  `purchase_request_priority` naming/posture).
- `purchase_requests.reason_code purchase_request_reason_code` — **nullable, NO default.**
  Legacy rows (created before this unit) stay `null` = pre-feature, **unscored** by U5. New
  rows are required to carry one, enforced on the write paths (below), not by a column `NOT NULL`
  (which would force a dishonest backfill) nor a DB `CHECK` (deliberately omitted, matching the
  requester-field posture of `priority` / `needed_by` — ADR 0026: requester-set fields are
  validator-authoritative so dump/restore and fixtures aren't churned).
- Additive `grant insert (reason_code) on purchase_requests to authenticated` — the INSERT grant
  is column-scoped (spec 33 / `20260616000400`); `reason_code` joins `priority` etc. **No UPDATE
  grant** (set once at create, like `priority` — no edit path planned).
- The insert **RLS policy is untouched** — required-ness lives in the action validator + the form,
  not in `WITH CHECK` (so files 70/73/91/115 pins stay green, and the 64 existing fixtures that
  insert as the table owner keep working with a `null` reason_code).

### Write paths

- **Form path** (`createPurchaseRequest` → RLS insert): `validateCreatePurchaseRequest` gains a
  required `reasonCode` (valid enum value or the input is rejected); the action inserts
  `reason_code`. The form gets a required reason `<select>` (no preselect — a disabled
  "เลือกเหตุผล" placeholder; submit stays disabled until a reason is chosen).
- **Site-purchase path** (`record_site_purchase`, SECURITY DEFINER, bypasses RLS):
  DROP+CREATE adds a **required** `p_reason_code purchase_request_reason_code` param (placed
  before the optional `p_amount` — defaulted params must come last); guards `null → P0001`;
  inserts it; records it in the audit payload. Re-grant execute to `authenticated`, revoke from
  `public, anon` (the DROP-re-grant lesson). `validateSitePurchase` + `recordSitePurchase` +
  `SitePurchaseForm` carry `reasonCode`.
- **Shared module** `src/lib/purchasing/reason-code.ts`: `PurchaseReasonCode` type +
  `PURCHASE_REASON_CODES` array + `isPurchaseReasonCode` guard (the validators + both forms
  iterate/check against this single source). Thai labels in `PURCHASE_REQUEST_REASON_CODE_LABEL`
  (`labels.ts`).

### Out of scope for U4 (→ U5)

Displaying the reason on the request card/list and any planned-vs-reactive aggregation. U4 only
**captures + stores + requires** the tag; the column carries it for U5 to read.

### Tests

- pgTAP `179-purchase-request-reason-code` — enum exists with the exact 5 labels; column exists,
  nullable, correct type; `authenticated` has INSERT (not UPDATE) on `reason_code`; new
  `record_site_purchase` signature requires reason_code (`null → P0001`), records it; the old
  signatures are gone; anon execute revoked.
- vitest `validate-purchase-request.test.ts` (+reasonCode: missing / invalid / valid) ·
  `validate-site-purchase.test.ts` (+reasonCode: missing / valid) · a form test per flow that the
  required reason picker renders and gates submit.

## U5 — measurement (the PM-accuracy number)

The payoff of the whole arc: surface **planned vs reactive** so the operator can see how
well a PM planned a project. The plan (`supply_plan_lines`) is the intent; the reactive
purchase requests tagged `unplanned_miss` (U4) are the scrambles that count against the PM.
"If the PM plans perfectly, the site admin never scrambles."

**What can honestly be measured.** Purchase requests carry a `work_package_id` and a free-text
`item_description` (NOT a `catalog_item_id`), so a PR cannot be matched to a specific plan
**line** by item — the only shared axis is the **work package**. So the measure is count-based,
per WP: planned line count vs reactive PR counts by reason. No fabricated "% of plan executed"
(we don't have the join for it).

### RPC

`supply_plan_accuracy(p_project_id uuid)` — SECURITY DEFINER, planner tier
(`project_manager`/`super_admin`/`project_director`, with `project_director` named per the file-91
pin) + `can_see_project`; unknown project → `22023`. Returns a TABLE, **one row per work package**
in the project that has a plan line OR a purchase request (plus a `work_package_id IS NULL` =
site-general row when the plan has WP-less lines):
`work_package_id`, `wp_code`, `wp_name`, `planned_lines int`, `planned_qty numeric`,
`unplanned_miss int`, `fair_reactive int` (rework/breakage/scope_change/unforeseeable),
`untagged int` (legacy PRs with null reason_code). A FULL OUTER JOIN of the per-WP planned
aggregate and the per-WP PR aggregate (PRs joined to the project via `work_packages.project_id`),
ordered worst-offender first (`unplanned_miss desc`). **All PR statuses count** — a reactive
request was raised = a planning gap surfaced; a status filter (exclude cancelled/rejected) is a
flagged refinement once the operator sees real numbers.

### Surface

A read-only **"ความแม่นยำการวางแผน"** section on `/projects/[projectId]/supply-plan`
(server component `SupplyPlanAccuracy`): project totals (planned lines · `unplanned_miss`
**highlighted** = the misses that count against the PM · fair reactive · untagged) + a compact
per-WP table (site-general shown as "ทั้งโครงการ"). The page sums the per-WP rows for the totals.

### Per-PM attribution / out of scope

Each project's plan has a planner (`supply_plans.created_by`), so the **per-project** number IS
the per-PM-per-project accuracy. A **cross-project per-PM roll-up** (an org-wide leaderboard) is a
separate org-level surface — flagged as a follow-up, not built here.

### Tests

pgTAP `180-supply-plan-accuracy` — function exists + secdef + anon-revoked; role gate
(visitor/non-member 42501, unknown project 22023); behaviour over a seeded plan + PRs
(per-WP planned/miss/fair/untagged counts, a PR-only WP, a site-general planned row). A vitest
`supply-plan-accuracy.test.tsx` renders the totals + highlights the miss count.

## Open decisions (flagged for the operator before U2/U3 lock them)

1. **One plan per project** (no versioning/amendments yet) — is a single living plan right, or do
   you want versioned plans (re-plan mid-project)? Affects how "frozen baseline" is preserved.
2. **No price/ETA in the plan** — the plan is PM _intent_ (item + qty + WP). Buy-price / ETA /
   compared quotations live in the procurement-execution flow (later), not the plan. OK?
3. **Reason-code taxonomy** for reactive PRs (U4): proposed `unplanned-miss` / `rework` /
   `breakage` / `scope-change` / `unforeseeable` — only `unplanned-miss` counts against the PM.
   Confirm the list.

## Verification

`pnpm lint && pnpm typecheck`; `pnpm db:test` (file 176 green, suite green); `pnpm build`.
DB-only foundation — no app surface this unit (verified by pgTAP).
