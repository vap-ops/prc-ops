# Spec 197 — คลัง as a per-project surface (move store out of settings)

**Why:** operator — the store (`/store`) is a daily field/ops tool but currently
lives only as a `/settings` drill-down under the "Data Master" section, next to
static reference data (vendors, catalog). Wrong category (store is the materials
_ledger_, transactional — รับเข้า every delivery, เบิก every withdrawal, ตรวจนับ
periodic — not set-once config) and wrong audience (page gated `BACK_OFFICE_ROLES`,
so `site_admin` — the on-site storekeeper who physically receives and issues
material — is locked out entirely). Store is also per-project, yet reached via a
global picker.

**Decision (operator, this session):** the store is a **per-project destination,
reached after selecting a project** — not a global nav door. It slots into the
project-detail surface exactly like `แผนจัดหา` / `ตารางงาน`: a header icon-chip →
a sub-route `/projects/[projectId]/store`. projectId comes from the route, so the
project picker disappears and RLS already scopes the viewer. Term = **`คลัง`**
(register in `labels.ts` as the destination SSOT; the spec-195 PR phrase "เข้าสโตร์"
is a different context — leave it).

This is design-shaped because it changes placement, access, and consolidates the
count surface. It does **not** add new store capability — every engine (stock-in,
issue, custody, count, reversal, P&L, GL) already exists from specs 177/178/195.
The work is relocation + access-widening + ตรวจนับ consolidation + empty state.

## Access model (per-action, replaces the flat `BACK_OFFICE_ROLES` page gate)

Chip + page visible to **`WP_DETAIL_ROLES`** (`site_admin · project_manager ·
super_admin · project_director · procurement`) — the same set that can already
open a project's WPs. Membership-scoped by RLS. Within the page, each action keeps
its own gate:

| Action              | Who                                | Note                            |
| ------------------- | ---------------------------------- | ------------------------------- |
| view on-hand        | all who see the chip               |                                 |
| รับเข้า stock-in    | `site_admin` · `procurement`       | the two who receive deliveries  |
| เบิก issue→WP       | `site_admin` · PM tier             | procurement read-only (no เบิก) |
| ตรวจนับ             | `site_admin` · PM tier             | both modes below                |
| กลับรายการ reversal | = the reversed action's gate       |                                 |
| confirm receipt     | the named worker (`/portal`)       | unchanged                       |
| Store P&L           | `super_admin` · `project_director` | header ⓘ                        |
| sell-rate setter    | `super_admin`                      | stays on `/catalog`, unchanged  |

**The headline change is adding `site_admin`.** If the underlying definer RPCs
(`record_stock_in`, `record_stock_count`, …) are gated narrower than this table
(e.g. `BACK_OFFICE` excludes `site_admin`), widen them by migration — source the
definer body **from LIVE**, not a stale copy, and re-grep every signature pin
(see `prc-ops-db-migration-lessons`). `issue_stock` is already `SITE_STAFF`-gated.

## Units

Each unit is its own TDD loop (failing test first) and its own ship. Do not start
the next unit in the same session.

### U1 — คลัง project sub-route + chip

- New route `app/projects/[projectId]/store/page.tsx`, mirroring
  `app/projects/[projectId]/schedule/page.tsx`: own `DetailHeader` (back →
  project), gated to `WP_DETAIL_ROLES`, projectId from the route param (no
  picker). It renders the existing `StoreManager` for that one project.
- Add a `คลัง` icon-chip to the project-detail `DetailHeader` chip row
  (`app/projects/[projectId]/page.tsx`, in the chip block ~lines 138–197),
  positioned **after `แผนจัดหา`** (plan → hold lifecycle order). Chip visible when
  `WP_DETAIL_ROLES.includes(ctx.role)` — add a `canSeeStore` flag alongside the
  existing `canPlanSupply` / `canOpenSchedule`.
- Widen the store access so `site_admin` is admitted (page gate = `WP_DETAIL_ROLES`,
  not `BACK_OFFICE_ROLES`). If `record_stock_in` is RPC-gated narrower than
  `site_admin · procurement`, migrate to widen (definer body from LIVE).
- Remove the two `/store` `SettingsLink`s (`app/settings/page.tsx` ~171 procurement,
  ~241 isManager). Store is no longer a settings item.
- Legacy top-level `/store` route: leave a thin redirect to the projects hub
  (`/projects`) so muscle-memory / old links resolve, or delete it. Pick redirect.
- `labels.ts`: add `STORE_LABEL = "คลัง"` (or equivalent) and use it for the chip,
  header, and bottom-tab match. Single-source it.

### U2 — ตรวจนับ unified into คลัง (retire `/stock-count`)

Count currently lives in two places: a per-row spot count on the store surface
(Mode A, spec 178 B2/U10) **and** a standalone `/stock-count` full-list page
(site_admin's only count surface today, because they were locked out of `/store`).
Once `site_admin` reaches `คลัง`, the split is redundant. Unify — two modes, one
home, one table/RPC (`stock_counts` + `record_stock_count`, **no DB change**):

- **Mode A — spot / cycle count.** Per-row `[นับ]` button → counted-qty sheet +
  live variance preview (`ส่วนต่าง ±N ขาด/เกิน/ตรงกัน`). Keep the existing U10
  component.
- **Mode B — full stocktake.** A `ตรวจนับทั้งคลัง` top action on the คลัง page →
  the `/stock-count` page's full-list-of-items component, every item with a
  counted-qty field + running variance, batch submit. **Relocate that component
  into the คลัง page**; do not keep a second route.
- Retire the standalone `/stock-count` route + its `Field Tools` settings link.
  Thin redirect to `/projects` (same posture as U1's legacy `/store`).
- Both modes hit the same `record_stock_count` (SITE_STAFF gate, snapshots
  system_qty, reconciles on-hand to counted truth; shrinkage = store P&L hit).
  Count history (`ประวัติการนับ`, spec 178 B3) hangs off either.

### U3 — empty-คลัง state (first-project readiness)

A brand-new project has an empty store; `ตรวจนับทั้งคลัง` on zero items is
meaningless and a bare empty list is a dead end. The empty state should:

- Lead with the `รับเข้าสต๊อก` action (primary).
- Show one line: "ยังไม่มีของในคลัง — เริ่มจากรับเข้า หรือผ่านแผนจัดหา" with the
  "แผนจัดหา" portion linking to the project's `supply-plan` chip (the procure-into-
  store path, spec 195).
- Suppress `ตรวจนับทั้งคลัง` while the store is empty.

Ties into the first-real-project adoption arc (spec 192).

## Out of scope / open

- **No new store capability.** Engines all exist. This spec is placement + access +
  consolidation only. Resist "while I'm here" additions (CLAUDE.md scope discipline).
- Cross-project / portfolio store P&L rollup (an oversight role wanting all
  projects' stores at once) — a separate future need; this spec keeps everything
  project-scoped per the operator decision.
- Procurement gets the in-project `คลัง` chip (operator: "procurement can also
  access in project"). They still land in store mainly via PO-receive (spec 195 P3
  auto stock_receipt); the chip is the standalone entry.
- WP-detail เบิก (`WpIssueStock` in the คำขอซื้อ tab) stays — contextual issue at
  the point of work, complementary to the คลัง-wide view. Two valid entries to the
  same `issue_stock`.
- Bottom-tab behavior: `/store` is in the `SETTINGS_TAB` match array
  (`bottom-tab-bar.tsx`). After the move, the project sub-route lives under the
  projects tab; update the tab-match arrays so the projects tab lights on
  `/projects/[id]/store` and the settings tab no longer claims `/store` /
  `/stock-count`.
