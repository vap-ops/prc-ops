# Spec 272 — Worker level + หัวหน้าช่าง badge manage UI (roster surfacing)

**Status: BUILD (single session, code-only — NO schema).**
Operator gap report (2026-07-06): "no UI exists to manage technician/worker
info — levels, roles/badges (HT badge), or the per-level sell-rate table."

## Context — what already exists (live-verified 2026-07-06)

Spec 161 / ADR 0060 built the **entire schema layer** for this; none of it ever
got a roster-side UI:

| Piece                                                               | Where                                                               | State                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `workers.level` (`worker_level` enum: senior/mid/junior/apprentice) | mig `20260760000000`                                                | live, granted to authenticated, **0 UI readers**                                                                                |
| `set_worker_level(p_worker, p_level)`                               | same                                                                | live, **super_admin only** (anti-favoritism ADR 0060 §5), no UI caller                                                          |
| `sell_rate_table` + `set_sell_rate`                                 | same                                                                | live (4 seeded rows) — **editor UI EXISTS** at `/nova/dials` (spec 161 U7)                                                      |
| `projects.ht_worker_id` + `assign_project_ht(p_project, p_worker)`  | mig `20260762000000`, rebuilt by spec 266                           | live; gate **pm/pd/super**; requires the worker **`pay_type='daily'` AND `active`**; last-wins (no unassign path); no UI caller |
| Level Thai labels                                                   | `src/lib/nova/dials.ts` `WORKER_LEVEL_LABEL` / `WORKER_LEVEL_ORDER` | existing SSOT — **reuse, do not re-roll**                                                                                       |

So this spec is pure surfacing on `/workers` (the roster, gate
`WORKER_ROSTER_ROLES` = PM-tier + procurement + procurement_manager) + one
discoverability link. The sell-rate table is **not** rebuilt — `/nova/dials`
stays its one editor (money-format/DRY doctrine).

Coordination: spec 271 (plan-vs-actual + site-role incentives, design pending)
will consume the HT designation as WP-Owner eligibility — it reads
`projects.ht_worker_id`; no new badge column is needed for that. If a
project-independent "HT-certified" qualification is ever wanted, that is a new
column + its own spec, not this one.

Data note: the live roster is currently **empty** (workers=0 — the spec 266
greenfield wipe); this UI ships ahead of the data on purpose. `sell_rate_table`
keeps its 4 seeded rows; no project has an HT yet.

## U1 — ระดับช่าง (skill level) on the roster

- `/workers/page.tsx`: workers select gains `level`.
- `ManagedWorker` gains `level: WorkerLevel | null`.
- **Row display** (all roster viewers): name line gains `· ระดับ<label>` (e.g.
  `· ระดับอาวุโส`) when graded; ungraded shows nothing on the row (no noise).
- **Edit sheet — grade selector, `canGrade` (super_admin) only**: a
  `ระดับช่าง` `<select>`; options = `WORKER_LEVEL_ORDER` labelled by
  `WORKER_LEVEL_LABEL`. An ungraded worker's select starts on a disabled
  placeholder `ยังไม่ประเมิน`; a graded worker's select has **no** placeholder
  option (the RPC has no clear-to-null path — un-grading is impossible by
  design, don't fake it). Saving with a changed level calls the new action.
- **New server action `setWorkerLevel({ id, level })`** (`workers/actions.ts`):
  UUID + enum-membership validation → `rpc("set_worker_level")` →
  `revalidatePath("/workers")`. Generic Thai error on failure (RPC enforces the
  real gate; non-super gets the generic error).
- Page passes `canGrade = ctx.role === "super_admin"` into the manager.

## U2 — หัวหน้าช่าง (HT) badge + assign

- `/workers/page.tsx`: projects select gains `ht_worker_id` (granted column);
  `AssignableProject` gains `ht_worker_id: string | null`.
- **Row badge** (all roster viewers): when the worker is some project's HT,
  the name line shows `· หัวหน้าช่าง <code>` (`text-action` emphasis; joins
  codes if HT of several — rare).
- **Edit sheet — assign block, `canAssignHt` (`PM_ROLES`: pm/pd/super) only**,
  rendered for **daily** workers (mirrors the RPC's reachable set):
  - Worker already HT of their current project → static line
    `หัวหน้าช่างของโครงการนี้`.
  - Eligible (active + daily + has `project_id`, not already that project's
    HT) → button `ตั้งเป็นหัวหน้าช่าง — <code>`; when that project already has
    a different HT, a caption `จะแทนที่: <current HT name>` (last-wins is the
    RPC contract — make the replacement visible before the tap).
  - No current project → muted hint `กำหนดโครงการก่อนจึงตั้งหัวหน้าช่างได้`.
    Inactive → no block beyond the daily gate (row is dimmed already).
- **New server action `assignProjectHt({ projectId, workerId })`**: UUID
  validation → `rpc("assign_project_ht")` → `revalidatePath("/workers")`;
  generic Thai error otherwise.
- Parent computes per-row `isHtOfCurrentProject` + `currentProjectHtName`
  (worker-name map over the already-loaded roster) — no extra queries.

## U3 — sell-rate discoverability link

- `/workers/page.tsx` content head, **super_admin only** (matches
  `/nova/dials`'s own `requireRole`): a small link
  `ตารางราคาขายตามระดับ (Nova) →` to `/nova/dials`. No new page, no
  settings-hub change.

## Constraints

- **NO migrations, NO `db:push`/`db:test`** — schema lane untouched.
- **Do NOT touch** `src/lib/i18n/labels.ts`, `src/app/settings/sections.ts`,
  `src/lib/db/database.types.ts` (open PR #325 / spec 268 owns them; `level`,
  `ht_worker_id`, both RPCs are already in the generated types).
- Level labels import from `@/lib/nova/dials` (the existing SSOT; relocating it
  would churn nova files for zero behavior).
- Design tokens only (field-first); no raw palette classes.

## TDD (failing tests first)

Vitest, `tests/unit/`:

1. **worker-roster-level-ht.test.tsx** (component): graded row shows
   `ระดับอาวุโส`; ungraded row shows no ระดับ text · grade select renders only
   when `canGrade`, placeholder only when ungraded, change+save calls
   `setWorkerLevel` with the enum value · HT badge renders from
   `projects.ht_worker_id` match · assign button renders only when
   `canAssignHt` ∧ daily ∧ active ∧ has project ∧ not already HT; tap calls
   `assignProjectHt({projectId, workerId})`; replace caption names the current
   HT; already-HT shows the static line; no-project shows the hint; monthly
   worker gets no HT block.
2. **workers actions** (extend the existing action test pattern):
   `setWorkerLevel` rejects bad UUID / bad level without an RPC call, relays
   `p_worker`/`p_level`, maps RPC error → generic Thai; `assignProjectHt`
   rejects bad UUIDs, relays `p_project`/`p_worker`, maps error.

## Out of scope (listed, not built)

- Un-assign HT / clear level (no RPC paths — supersede-style history not
  wanted here; last-wins + audit_log rows are the record).
- Sell-rate editing on `/workers` (exists at `/nova/dials`).
- Level in the ADD form (grade-after-create keeps the single
  `set_worker_level` audit path).
- Settings-hub card changes (deferred with #325's `sections.ts` ownership).
- Per-worker "HT-certified" qualification column (spec 271's call if needed).

## Verification checklist

- `pnpm lint && pnpm typecheck && pnpm test` green.
- No diff under `supabase/`, `src/lib/i18n/labels.ts`,
  `src/app/settings/sections.ts`, `src/lib/db/database.types.ts`.
- Live read-only probe already done pre-build: RPC bodies + gates match this
  spec (assign_project_ht = pm/pd/super, daily+active; set_worker_level =
  super_admin).
