# Technician progress view — Implementation Plan (spec 350)

> **For agentic workers:** each unit ships through the repo's `ship-unit` skill (lane claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes → gated ship). This plan is the blueprint ship-unit executes. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fill the `งานที่ได้รับมอบหมาย` coming-soon placeholder on `/technician` with a real, read-only view of the technician's most-recent muster team's work packages, each showing status + parent-งาน progress.

**Architecture:** One self-scoped `SECURITY DEFINER` read RPC (`get_my_assigned_work`) resolves `auth.uid()` → worker → latest muster team → that team's WPs, returning each WP plus the relevant งาน's child statuses. A pure TS view-model maps those rows to display rows, reusing the existing `deriveDeliverableProgress` SSOT for the %. The `/technician` server component renders them via the existing `StatusPill`.

**Tech Stack:** Postgres/Supabase (plpgsql-free SQL DEFINER fn), pgTAP; Next.js App Router Server Component; Vitest.

## Global Constraints (verbatim from spec 350 + repo rules)

- **Read-only.** No writes, no status edits, no actions (ADR 0074 keeps งาน oversight-only).
- **Self-scoped.** RPC returns only the caller's own team's WPs — a technician is not a project member (`can_see_project` returns **false** for `technician`, verified live), so this must be a DEFINER RPC, never a policy widening.
- **RLS session client only** in the page (never `admin.ts`).
- **No money / no attendance / no OT** on this surface — separate spec-306 track.
- **Progress rule is single-sourced** to `deriveDeliverableProgress` (`src/lib/deliverables/derive-progress.ts`): `complete` iff `status === 'complete'`; `percent = round(100 * complete / total)`.
- RPC grants: `revoke all … from public; revoke execute … from anon; grant execute … to authenticated` (mirror the muster RPCs in `…075750_spec306u2_muster_schema.sql`).
- TDD, RED-first; Conventional Commits.

## Dependency gate-check (RE-RUN at build time — main will have advanced past `2c434627`)

- `workers.user_id` column exists ✓ (live-verified 2026-07-23). Re-confirm the caller binding: `workers.user_id = auth.uid()`.
- `muster_attendance(worker_id, team_id, work_date)` + `muster_team_wps(team_id, work_package_id)` ✓ live-verified.
- `work_packages` columns `id, code, name, is_group, status, parent_id` ✓ (`code`/`name` used by `schedule-gantt`, receipts read).
- `get_my_assigned_work` does **not** already exist ✓ (live-verified `pg_proc` count 0).
- Migration number: claim the next free timestamp when the **schema lane frees** — currently held by lane 348 U3 (`20260813075843`); next-after-that is `…075844`, but re-read `../LANES.md` STATUS + `supabase/migrations/` at build time.

## File map

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_spec350u1_get_my_assigned_work.sql` | create | the DEFINER read RPC |
| `supabase/tests/database/350-technician-assigned-work.test.sql` | create | pgTAP for the RPC |
| `src/lib/technician/assigned-work-view.ts` | create | pure RPC-row → display-row view-model |
| `tests/unit/assigned-work-view.test.ts` | create | vitest for the view-model |
| `src/components/features/technician/assigned-work-card.tsx` | create | the card (renders display rows) |
| `src/app/technician/page.tsx:63-94, 144-152` | modify | batch the RPC into the existing `Promise.all`; replace the placeholder card |

---

## Task U1 — `get_my_assigned_work()` RPC (schema; operator-merged)

**Files:**
- Create: `supabase/migrations/<ts>_spec350u1_get_my_assigned_work.sql`
- Test: `supabase/tests/database/350-technician-assigned-work.test.sql`

**Interfaces — Produces:**
```sql
public.get_my_assigned_work() returns table (
  wp_id                uuid,
  code                 text,
  name                 text,
  is_group             boolean,
  status               public.work_package_status,
  parent_id            uuid,
  parent_code          text,
  parent_name          text,
  group_child_statuses public.work_package_status[],  -- relevant งาน's children; group→own children, leaf→parent's children, else '{}'
  work_date            date
)
```

- [ ] **Step 1 — pgTAP RED first.** Write `350-technician-assigned-work.test.sql` (standard `begin; select plan(N); …; select * from finish(); rollback;`). Seed under a `set local role`/JWT-as-technician harness (mirror an existing self-scoped RPC test, e.g. the `current_user_worker_id` / 306 muster tests). Assertions:
  1. bound technician with attendance on one date → returns exactly that team's assigned WP codes.
  2. an assigned **group** row → `is_group` true, `group_child_statuses` = its children's statuses (order-independent — compare as multiset/sorted).
  3. an assigned **leaf** row (sub-WP override) → `parent_code`/`parent_name` populated, `group_child_statuses` = the parent's children's statuses.
  4. worker mustered on **two dates** → only the `max(work_date)` team's WPs returned, and `work_date` = that date.
  5. **no leak:** as worker A, worker B's team WPs never appear.
  6. **empty:** a caller with no `workers` row, and a worker with no attendance → 0 rows.
  7. **grants:** `has_function_privilege('anon', …, 'execute')` is false; `'authenticated'` is true.

- [ ] **Step 2 — run, verify RED.** `pnpm db:test` (after `pnpm db:link`); the new file fails (function absent).

- [ ] **Step 3 — write the migration.** SQL DEFINER function:
```sql
create or replace function public.get_my_assigned_work()
returns table (
  wp_id uuid, code text, name text, is_group boolean,
  status public.work_package_status, parent_id uuid,
  parent_code text, parent_name text,
  group_child_statuses public.work_package_status[], work_date date
) language sql stable security definer set search_path = public as $$
  with latest as (
    select a.team_id, a.work_date
      from public.muster_attendance a
      join public.workers w on w.id = a.worker_id
     where w.user_id = auth.uid()
     order by a.work_date desc
     limit 1
  )
  select
    wp.id, wp.code, wp.name, wp.is_group, wp.status, wp.parent_id,
    p.code, p.name,
    coalesce((
      select array_agg(c.status)
        from public.work_packages c
       where c.parent_id = case when wp.is_group then wp.id else wp.parent_id end
    ), '{}'::public.work_package_status[]),
    latest.work_date
  from latest
  join public.muster_team_wps mtw on mtw.team_id = latest.team_id
  join public.work_packages wp on wp.id = mtw.work_package_id
  left join public.work_packages p on p.id = wp.parent_id
  order by wp.code;
$$;
revoke all on function public.get_my_assigned_work() from public;
revoke execute on function public.get_my_assigned_work() from anon;
grant execute on function public.get_my_assigned_work() to authenticated;
```

- [ ] **Step 4 — push + regen types + verify GREEN.** `pnpm db:push` → `pnpm db:types` (adds the row type to `database.types.ts`) → `pnpm db:test` (350 file passes; full suite only the tolerated known-red 221).

- [ ] **Step 5 — real-flow verify (no browser).** `pnpm exec supabase db query --linked` calling `get_my_assigned_work()` while impersonating a real bound technician who has a muster attendance row; confirm the returned rows + `group_child_statuses` match the live team.

- [ ] **Step 6 — commit** (`feat(spec350): get_my_assigned_work self-scoped read RPC`). Ship via `ship-unit` (danger-path → operator-merged).

---

## Task U2 — the card (code-only; auto-merges on green)

**Files:**
- Create: `src/lib/technician/assigned-work-view.ts`, `tests/unit/assigned-work-view.test.ts`, `src/components/features/technician/assigned-work-card.tsx`
- Modify: `src/app/technician/page.tsx`

**Interfaces — Consumes:** `get_my_assigned_work()` rows (U1); `deriveDeliverableProgress` (`@/lib/deliverables/derive-progress`); `StatusPill` (`@/components/features/common/status-pill`), `workPackageStatusPillClasses` (`@/lib/status-colors`), `workPackageStatusIcon` (`@/lib/status-icons`), `WORK_PACKAGE_STATUS_LABEL` (`@/lib/i18n/labels`).

**Interfaces — Produces (view-model):**
```ts
export interface AssignedWorkRow {
  wpId: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  /** progress of the relevant งาน: the row's own children if it's a group, else its parent's. null when there is no group context (totalCount 0). */
  groupProgress: { percent: number; completeCount: number; totalCount: number } | null;
  /** parent งาน label for a leaf row; null for a group/ungrouped row. */
  parentName: string | null;
}
export interface AssignedWorkView {
  workDate: string | null;   // from row[0]; null when empty
  rows: AssignedWorkRow[];    // empty ⇒ card shows the empty state
}
export function buildAssignedWorkView(
  rpcRows: ReadonlyArray<{
    wp_id: string; code: string; name: string; is_group: boolean;
    status: WorkPackageStatus; parent_id: string | null;
    parent_code: string | null; parent_name: string | null;
    group_child_statuses: WorkPackageStatus[]; work_date: string;
  }>,
): AssignedWorkView;
```
Mapping rule: `const p = deriveDeliverableProgress(row.group_child_statuses); groupProgress = p.totalCount > 0 ? {percent,completeCount,totalCount} : null; parentName = row.is_group ? null : row.parent_name;`

- [ ] **Step 1 — vitest RED first** (`tests/unit/assigned-work-view.test.ts`):
  1. a group row with children `['complete','complete','in_progress']` → `groupProgress = {percent:67, completeCount:2, totalCount:3}`, `parentName: null`.
  2. a leaf row (`is_group:false`, `parent_name:'งานปูกระเบื้อง'`, `group_child_statuses` the parent's children) → `parentName:'งานปูกระเบื้อง'`, `groupProgress` from those statuses.
  3. an ungrouped leaf (`parent_id:null`, `group_child_statuses:[]`) → `groupProgress: null`, `parentName: null`.
  4. empty input → `{ workDate: null, rows: [] }`; non-empty → `workDate` = `rows[0].work_date`.

- [ ] **Step 2 — run, verify RED** (`pnpm exec vitest run assigned-work-view`).

- [ ] **Step 3 — implement `assigned-work-view.ts`** per the mapping rule above. Pure, no I/O, no React.

- [ ] **Step 4 — GREEN** (`pnpm exec vitest run assigned-work-view`).

- [ ] **Step 5 — build the card** `assigned-work-card.tsx` (Server Component, `props: { view: AssignedWorkView }`). Reuse the existing `CARD` shell. Title `งานที่ได้รับมอบหมาย` + the `workDate` (วันนี้ if it is today's date, else the date). Per row:
  - `<StatusPill pillClasses={workPackageStatusPillClasses(r.status)} icon={workPackageStatusIcon(r.status)}>{WORK_PACKAGE_STATUS_LABEL[r.status] ?? r.status}</StatusPill>` + `code` + `name`.
  - group row → `{percent}% ({completeCount}/{totalCount} งานย่อย เสร็จ)` when `groupProgress`.
  - leaf row → `อยู่ในงาน {parentName} · {percent}%` when `parentName` && `groupProgress`.
  - `rows.length === 0` → empty state `ยังไม่มีงานที่ได้รับมอบหมาย`.

- [ ] **Step 6 — wire the page** (`src/app/technician/page.tsx`): add `supabase.rpc("get_my_assigned_work")` to the existing `Promise.all` (destructure `{ data: assignedWork }`), build `buildAssignedWorkView(assignedWork ?? [])`, and replace the placeholder card (lines ~144-152) with `<AssignedWorkCard view={…} />`. Remove the now-unused `ComingSoonBadge` import if nothing else uses it.

- [ ] **Step 7 — real-flow verify (browser).** dev-preview login as a bound technician who has a muster attendance row (`dev-preview-login` recipe); load `/technician`; confirm the card renders the team's WPs + %, correct empty state for a technician with no attendance; zero console errors.

- [ ] **Step 8 — commit + ship** (`feat(spec350): technician assigned-work progress card`). Code-only → auto-merges on green.

---

## Self-review

- **Spec coverage:** U1 = the RPC + rationale (spec §Design/U1) ✓; U2 = the card, status pill, group/leaf progress copy, work-date header, empty state, read-only (spec §Design/U2) ✓. Non-goals respected (no attendance/money/OT/actions/persistent-assignment) ✓.
- **Placeholders:** none — RPC body, view-model signature, and each test case are concrete.
- **Type consistency:** `group_child_statuses: WorkPackageStatus[]` produced by U1 is consumed verbatim by `buildAssignedWorkView`; `AssignedWorkRow`/`AssignedWorkView` names match between the Produces block and the card props.
- **Open (from spec, not blocking):** "most-recent team" = `max(work_date)` (chosen); no sub-WP drill-in (v1 top line only).
