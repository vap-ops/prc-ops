# Spec 171 — Procurement can make purchase requests from the work-package screen

**Operator request (2026-06-21):** "There are times the procurement team needs to
make a purchase request instead of the site admins. Enable them to see [the work
package] just like site admins can, but only able to edit the PRs."

**Operator decision (clarifying question):** procurement should **open the
work-package screen** (the same screen site admins use) and see it; the only thing
they may add/edit there is the **purchase request** — photos, labour, etc. stay
**read-only** for them.

## Background — why this is more than "add procurement to the INSERT"

Today a purchase request is **created only from the WP detail page**
(`/projects/[projectId]/work-packages/[workPackageId]`, the คำขอซื้อ tab). There is
no standalone `/requests/new`, and `purchase_requests.work_package_id` is `NOT
NULL` — every request is raised in WP context. That page is gated to
`SITE_STAFF_ROLES` (site_admin / pm / super / director); **procurement is
deliberately excluded** (spec 70: it must not reach the SA capture screens).

`procurement` is a **cross-project** role (spec 102 / ADR 0056): its SELECT reach is
granted by explicit `current_user_role() = 'procurement'` arms on `projects`,
`work_packages`, `purchase_requests`. It is **not** a member of any project, so the
membership helper `can_see_project()` (and `can_see_wp()`) returns **false** for it.
Consequences that shape this spec:

- Procurement **cannot read** `photo_logs` / `labor_logs` / `approvals` today —
  those SELECT policies are pure `can_see_wp(...)` (no role arm), so a procurement
  session sees empty photos/labour/approvals.
- The current `purchase_requests` INSERT policy (spec 143/ADR 0056) requires
  `can_see_wp(work_package_id)` **and** role ∈ (sa, pm, super). Adding `procurement`
  to the role list is **not enough** — the `can_see_wp` arm would still deny it.

So "see the WP like a site admin + raise a request" needs a procurement
**cross-project arm** on those reads **and** on the INSERT (mirroring the spec-102
posture), plus a read-only rendering of the page for procurement.

`LaborLogZone` is **presence-only by construction** (no rate/cost columns; the
"flags" are self-logged markers, not money — money lives behind the PM-only
admin-client read on `/review`). So showing labour read-only to procurement leaks
no pay data. `wp_labor_costs` / `day_rate_snapshot` carry **no** authenticated grant
and are never read on this page → money stays invisible to procurement.

## U1 — RLS: procurement gains WP-context reads + PR insert (foundation)

**Migration `20260780000000_procurement_purchase_requests.sql`** — four policies
DROP+CREATE'd **in place** (names unchanged, so the `policies_are` / qual `like`
pins in pgTAP files 70 & 73 stay green; each keeps its `can_see_wp` arm, so the
sa/pm membership scoping is preserved). Each gains a `current_user_role() =
'procurement'` arm, mirroring `work_packages`/`projects` (spec 102):

- `photo_logs` SELECT — `procurement OR can_see_wp(work_package_id)`.
- `labor_logs` SELECT (`"labor logs readable by field and pm"` — the bound-contractor
  self-read policy is **untouched**) — `procurement OR can_see_wp(work_package_id)`.
- `approvals` SELECT — `procurement OR can_see_wp(work_package_id)`.
- `purchase_requests` INSERT (`"purchase_requests insert by wp-readers"`) — keep
  `requested_by = auth.uid()` + `source = 'app'`; the role gate becomes
  `((sa|pm|super) AND can_see_wp(work_package_id)) OR procurement`. Procurement is
  cross-project, so its arm carries **no** membership gate (consistent with its
  SELECT reach). The column-scope INSERT grant is already to `authenticated`
  (spec 33 / 20260616000400), so procurement — an `authenticated` user — needs no
  new privilege, only the policy arm.

Additive + reversible; `appsheet_writer` unaffected (`current_user_role()` is NULL
for that DB role → no arm admits it; it keeps its own `TO appsheet_writer`
policies). Procurement gains **no** UPDATE (the `"purchase_requests update by pm or
super"` policy is untouched — it still cannot approve/reject/decide) and **no**
write on photos/labour/approvals (those INSERT policies are untouched).

**Tests (test-first):**

- **File 17 (`17-purchase-requests.test.sql`) E.6 flips** — was "procurement INSERT
  denied (42501)"; now `lives_ok` "procurement self-insert is permitted (spec 171)".
  Plan count unchanged. E.1–E.5/E.7 (sa/pm/super permitted, foreign-requester /
  appsheet / visitor denied) are preserved by keeping those arms intact.
- **New file `115-procurement-wp-context.test.sql`** — qual-text pins (matching the
  `like '%can_see_wp%'` style already used for these policies in files 70/73) that
  each of the four policies now references `procurement`, **and** still references
  `can_see_wp` (so a future rewrite can't silently drop the sa/pm membership gate).
- **Verify:** `db:push` → `db:test` (files 17, 70, 73, 115 green; full suite 0
  failures) → `db:types` (no app-facing type change expected; RLS only).

## U2 — WP screen: admit procurement, render read-only (the request stays editable)

- **Page gate** (`app/projects/[projectId]/work-packages/[workPackageId]/page.tsx`):
  admit procurement via a named allowlist `WP_DETAIL_ROLES = SITE_STAFF_ROLES +
procurement` in `role-home.ts` (kept distinct from `PURCHASING_ROLES` per the
  "members coincide, meaning differs" doctrine). `const isProcurement = ctx.role ===
"procurement"`.
- **Read-only rendering for procurement** (`isProcurement` branches; write controls
  suppressed, not relabelled):
  - **รูปถ่าย** — render the read-only `PhaseGallery` (extracted from the `/review`
    page into `src/components/features/photos/phase-gallery.tsx` and imported by
    both) instead of the capture-only `PhotoCaptureZone` (which owns the fixed
    shutter bar). Behaviour-preserving extraction for `/review`.
  - **คำขอซื้อ** — keep `PurchaseRequestForm` (procurement may now insert). **Hide**
    `SitePurchaseForm` (its `record_site_purchase` RPC excludes procurement). Keep the
    existing-requests list.
  - **ทีมงาน** — `LaborLogZone` with `locked={true}` + `showFlags={false}` → history
    only, no capture form, no edit/correction button (`!locked || showFlags` → false).
  - **ข้อมูล** — notes shown as read-only text (no editor); approval history is
    already read-only.
  - **จัดการ** — already `isPlanner`-only; procurement is not a manager → not shown.
  - **Attention stack / header** — pass `isAssigner={!isProcurement}` so the
    contractor assign/reassign control and the "assign a contractor" card are hidden;
    **hide** `ReportDefectControl` for procurement.
- **Tests:** unit-test the gating decision (a small pure helper or the
  `WP_DETAIL_ROLES`/`isProcurement` derivation) — procurement is admitted and is
  treated as read-only (no write affordances), sa/pm/super keep full capability.
- **Verify:** `pnpm lint && typecheck && test && build`.

## U3 — procurement reads the contractors master (SHIPPED 2026-06-21)

U2 left the WP's assigned-contractor name blank in procurement's read-only info
sheet: the `contractors` SELECT policy was sa/pm/super/director only.

- **Migration `20260781000000_procurement_read_contractors.sql`:** add `procurement`
  to `"contractors readable by privileged roles"` (DROP+CREATE in place, name
  unchanged → file 24 `policies_are` holds; `project_director` kept per file 91).
  contractors is global master data, so this is a plain role-level read — the same
  posture as the suppliers master procurement already reads. The spec-130 external
  self-read policy is untouched.
- **No app change** — the page already renders the contractor read-only for
  procurement (`isAssigner = !readOnly` hides reassign; the assign-prompt is
  suppressed). Once the read resolves, the name simply appears.
- **Tests:** file 115 +1 — `contractors` SELECT qual references procurement.
  `db:test` 115 files / 2202 / 0.

## U4 — navigation: procurement's WP rows link to the detail (SHIPPED 2026-06-21)

Operator: procurement "still report unable to access WP details" after U1–U3.
Root cause was **navigation, not permission**: spec 102 gave procurement a
_separate_ read-only project view (`projects/[projectId]/page.tsx`, the
`ctx.role === 'procurement'` early return) whose WP rows were plain `<li>` cards
— **no link**. That "no links" rule predated U2 (which made the WP detail screen
accessible read-only), so procurement could see WP names but had no UI path to
open one.

- **Fix (no DB change):** each row in procurement's list is now a `<Link>` to
  `workPackageHref(project.id, wp.id)`; comment updated to note the spec-102
  "no links" rule is lifted by spec 171. The detail screen already renders
  read-only for procurement (U2). typecheck clean for the file.
- **Concurrent-session note:** the working tree carried an unrelated in-flight
  payroll/DC-payment refactor (another session) that was mid-compile, and the
  shared HEAD had been switched to its feature branch — so the global
  build/typecheck was red on _that_ work, not this. This one-file fix was
  committed in isolation and fast-forwarded to `main` (commit 9776c38).

## Out of scope / open questions

- **Editing an existing request's content** (item/qty/needed-by after creation): no
  such feature exists for _any_ role today — site admins only create. "Edit the PRs"
  is read as **author/create**. A true edit-request flow is a separate spec.
- **Granting procurement labour/approvals read across all projects** is an
  intentional consequence of "see the WP like a site admin"; it is additive and
  reversible (drop the arm) if the operator later wants procurement scoped tighter.
