# 245 — Ordering-plan templates (qty-only, clone-per-project)

**Status:** design approved via brainstorm 2026-07-01, spec pending operator review → plan.
**Follows:** the ทะเบียนวัสดุ category cleanup (spec 239, ✅ complete) — the operator's
original goal #2, now unblocked.
**Builds on:** `supply_plans` / `supply_plan_lines` (spec 176, 181, 189, 222) — already
a project-scoped, **qty-only, price-free** material plan. This spec adds a reusable
**template** variant of the same entity, not a new domain.

---

## 1. Purpose

The firm repeatedly builds the same store type ("TFM" = Thai Foods Fresh Market) in
two sizes — **16m wide** and **20m wide**. For a given size the material ordering plan
is nearly identical project to project; only a handful of items differ. Today every
project's supply plan starts from a blank grid — the PM re-enters the same ~dozens of
lines by hand each time.

**Goal:** two reusable, org-wide ordering-plan templates ("TFM 16m", "TFM 20m") that a
PM can **clone into any project** as a pre-filled starting draft, then adjust
**category by category** for that project's specifics. North star: **learn by
doing** — start from a working template and edit, never a blank page.

Future non-TFM clients will need other planning methods — explicitly **out of scope**,
later.

## 2. Locked decisions (from brainstorm)

| #   | Decision                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | A template **is** a `supply_plans` row (`is_template = true`), not a new entity. Reuses the existing lines table, RLS shape, and (with one fix, §5) the existing write RPCs. |
| D2  | Templates have **no separate lifecycle** — always editable, no submit/approve/reject. The template editor never exposes those actions.                                                        |
| D3  | Templates are **global** (`project_id` nullable, `null` for a template) — not tied to a dummy project. Visible to the existing supply-plan write-tier (§4), not per-project membership.        |
| D4  | **v1 seeds the 2 templates EMPTY** (name only, zero lines) via migration. The operator fills in the real TFM 16m/20m quantities **through the app itself**, using the same item-picker UI as any plan. No "create a new template" UI in v1 — only the 2 seeded ones are editable. |
| D5  | Cloned lines always land **whole-project** (`work_package_id = null`) — no WP-code matching. The planner allocates to real WPs afterward via the existing multi-WP fan-out (spec 222).        |
| D6  | "Adjusted per category" = the plan's line list **groups by category** for review (a display change), not a per-category checklist/approval flow.                                              |
| D7  | Clone reuses the **existing** write RPCs (`create_supply_plan` + `add_supply_plan_lines`) via a thin server action — no new RPC. `create_supply_plan` **always creates a fresh plan** (spec 189); cloning is simply "new plan, then bulk-populate from a template" — an alternate path beside "new blank plan," not a fallback for planless projects (a project may already have other plans). |

## 3. Data model

**Migration (additive):**

- `supply_plans.project_id` → **nullable** (was `not null`).
- `supply_plans` gains `is_template boolean not null default false`.
- `supply_plans` gains `name text` (nullable — only templates use it; a normal plan
  keeps its existing client-side auto-label "แผน #N").
- Check constraint: **exactly one** of `(is_template AND project_id IS NULL)` or
  `(NOT is_template AND project_id IS NOT NULL)` holds — a template can never carry a
  project, and a normal plan can never lack one.
- Seed: insert the 2 templates (`name = 'TFM 16m'`, `'TFM 20m'`), `is_template = true`,
  `project_id = null`, **zero lines**. `created_by` is nullable already, so a
  migration-time insert with no `auth.uid()` context is fine (lands `null`).

## 4. Access model (RLS + roles)

**Verified against the live RPCs** (spec 181's procurement addendum, not the older
spec 176 version — role lists drift forward; the addendum was the current source of
truth): the supply-plan write tier is
`project_manager / super_admin / project_director / procurement`
(procurement is cross-project, no membership gate — "PM's stead").

- **Read (RLS):** the existing `can_see_project(project_id)` branch stays for normal
  plans; **OR** `is_template = true` → readable by that same write tier (no
  membership check applies — there's no project). `site_admin` and any other role
  stay excluded, matching today's page-level gating on the supply-plan surface.
- **Write:** still exclusively through the existing RPCs. No new RPC. One correctness
  fix is required (below) to the RPCs the template editor calls.

**Required RPC fix (real bug this migration would otherwise introduce):**
`add_supply_plan_lines`, `add_supply_plan_line`, and `remove_supply_plan_line` all
share this pattern:

```sql
select sp.project_id, sp.status into v_project_id, v_status
  from public.supply_plans sp where sp.id = p_plan_id;
if v_project_id is null then
  raise exception '...: unknown plan' using errcode = '22023';
end if;
```

Once `project_id` is nullable, a `null` result has **two meanings** — "no such plan
row" and "this plan is a template" — and this code cannot tell them apart. It must be
restructured to check **row existence** (`FOUND`, or a separate `is_template` column
read) independently of `project_id`, then branch: unknown plan → error; `is_template`
→ skip `can_see_project` (role check still applies, exactly as it already skips
membership for `procurement`); else → `can_see_project(project_id)` as today.

At minimum `add_supply_plan_lines` (bulk-add, used by the template editor to save
rows) and `remove_supply_plan_line` (used to delete a template row) need this fix —
they are the two RPCs actually reachable from template editing. `submit_supply_plan` /
`approve` / `reject` / `reopen` are never called against a template (D2 — no
lifecycle UI) and do not need touching.

## 5. Clone mechanism

A new **server action** `cloneSupplyPlanTemplate({ templateId, projectId })` —
**zero new RPCs**:

1. Call the existing `create_supply_plan(projectId)` — per spec 189 this **always
   creates a fresh empty draft plan** (not get-or-create) and returns its id.
2. Read the template's lines (`catalog_item_id`, `qty`, `note`) — a plain `select`,
   permitted by the new RLS branch (§4).
3. Map each to `{ catalogItemId, workPackageId: null, qty, note }`.
4. Call the existing `add_supply_plan_lines` (the atomic bulk RPC — "any bad line
   raises → whole batch rolls back," verified in its own migration comment) with the
   mapped array.

**Failure mode (accurate — not "idempotent retry"):** step 4 is atomic, so it never
partially populates a plan. If it fails (or the request never completes), the PM is
left with a **harmless empty draft plan** from step 1 — trivially deletable via the
existing `delete_supply_plan` action, or just abandoned. Retrying the clone action
creates a brand-new plan (step 1 always makes a fresh one); it never collides with or
duplicates into the failed attempt.

## 6. UI

Two touch points, reusing existing components:

- **Clone entry point** — on `/projects/[projectId]/supply-plan`, alongside the
  existing "new plan" button, a second option: pick a template ("TFM 16m" / "TFM
  20m") → "ใช้เทมเพลตนี้" (use this template). Calls `cloneSupplyPlanTemplate`, then
  navigates to `?plan=<newPlanId>` (mirroring the existing `NewPlanButton` pattern) —
  the grid then shows the cloned lines exactly like any other plan's, editable as
  normal, including WP allocation via the existing multi-WP fan-out.
- **Category grouping** — the existing (flat) lines list in `SupplyPlanManager` gains
  a grouping pass: lines sort/group by the item's category (already resolvable via
  `catalog_items.category_id`, no new data) instead of insertion order. This is a
  **real UI restructuring**, not a one-line sort — the component threads several
  pieces of per-line interactive state through the flat list today (the convert-mode
  selection `Set`, the `convertible` filter, the remove handler); grouping must
  preserve all of that across group boundaries. Applies to every plan's line list, not
  just cloned ones — a general improvement.
- **Template editing** — templates have no project, no WPs, no lifecycle. A **new,
  smaller page** `/settings/ordering-templates` (write-tier gated, §4) lists the 2
  templates; each opens (`/settings/ordering-templates/[templateId]`) into a
  **stripped-down editor**: item + qty + note rows only (no WP column, no
  submit/approve/convert-to-PR). This reuses the item-picker + qty-input + note-input
  + remove-button **row** as an extracted shared sub-component between the full
  `SupplyPlanManager` grid and this lighter editor — not a duplicated copy of the
  ~150-line row JSX.

**Implementation gotcha (mechanical, not a design question):** any new `page.tsx`
under `src/app` must be classified in `tests/unit/nav-back-affordance.test.ts`'s
anti-drift guard or the suite fails. The dynamic `[templateId]` detail route
auto-classifies (has a dynamic segment); the static `ordering-templates/page.tsx` list
needs a manual `STATIC_DETAIL` entry (mirrors `settings/usage`, `settings/friction-map`).

## 7. Units (test-first; each its own session per repo workflow)

- **U1 — schema + RLS + RPC fix (schema lane, held).** The migration (§3): nullable
  `project_id`, `is_template`, `name`, the check constraint, the 2 empty seed rows;
  the RLS branch (§4); the 3-RPC null-check fix (§4). pgTAP: template rows readable
  by write-tier without project membership, still denied to `site_admin`/anon; the
  check constraint; the fixed RPCs correctly distinguish "unknown plan" from "is a
  template" and still enforce role.
- **U2 — clone mechanism (code-only).** `cloneSupplyPlanTemplate` server action +
  its pure mapping helper (unit-tested: template lines → clone payload shape) + the
  clone entry point on the supply-plan page.
- **U3 — category grouping (code-only).** The `SupplyPlanManager` line-list grouping
  pass + its pure grouping helper (unit-tested), threading existing interactive state
  through groups.
- **U4 — template editor (code-only).** The extracted shared row sub-component +
  `/settings/ordering-templates` list + `[templateId]` editor, wired to the (now
  template-aware) existing RPCs. Registered in the nav-back-affordance guard.
- **U5 (operator, not a build unit) — populate the 2 templates.** The operator (or PM)
  fills in the real TFM 16m / TFM 20m line items through the U4 editor.

## 8. Out of scope (YAGNI — list, don't build)

Creating a *new* named template from scratch (only the 2 seeded ones are editable in
v1 — deferred until a 3rd template is actually needed). WP-code matching / auto-WP-
allocation on clone (D5 — always whole-project). A per-category checklist/approval
review flow (D6 — grouping is display-only). Non-TFM ordering methods (explicitly
"later," different clients need different methods). Any change to `supply_plan`'s
existing lifecycle (submit/approve/reject/reopen) — untouched.

## 9. Governance / risk

- **Danger-path:** U1 is a schema change (nullable column, new columns, RLS,
  function bodies) → migration + reviewed PR + `supabase db push`; schema single-lane
  (claim in `LANES.md`). U2–U4 are code-only.
- **Correctness risk this spec specifically de-risks:** the 3-RPC null-project_id
  ambiguity (§4) is a latent bug this migration would silently introduce if left
  unfixed — it is treated as part of U1, not an afterthought.
- **Accuracy-measurement safety:** `supply_plan_accuracy` aggregates per-project
  (joined through `project_id`); a template's `project_id = null` can never match any
  real project's query — confirmed safe by construction, not just assumed.
- **PDPA/money:** no change — supply plans are already qty-only/price-free; templates
  don't add pricing.
