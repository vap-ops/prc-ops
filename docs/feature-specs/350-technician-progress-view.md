# 350 — Technician progress view (งานที่ได้รับมอบหมาย)

**Class:** mixed — **U1** (new self-scoped `SECURITY DEFINER` read RPC) is danger-path ⇒ operator-merged + single schema lane; **U2** (page + component + tests) is code-only.

**Origin:** operator direction 2026-07-23 — "we want technicians to be able to do more stuff related to them (Nova model)." First anchor chosen (over attendance/money, which sit on the deeper spec-306 U5 money spine): a **progress view**. It fills the `งานที่ได้รับมอบหมาย … เร็ว ๆ นี้` coming-soon placeholder that has stood on `/technician` since spec 264 G3 / 266 U7.

**What a ช่าง sees:** their most-recent muster team's work — *"what am I on, and how far along is it."*

## Current state (evidence)

- `/technician` (role `technician`) is the ช่าง's own portal: employee card, badge QR, wage history, profile, bank, receipts. The `งานที่ได้รับมอบหมาย` card is a static `ComingSoonBadge` placeholder (`src/app/technician/page.tsx:144-152`).
- A technician is always a **bound worker** — `workers.user_id = auth.uid()` (approve + claim both set it; spec 266 U7 comment on the same page).
- WP progress has **no numeric column** — it is `status` (`work_package_status`: `not_started / in_progress / on_hold / complete / pending_approval / rework`). A งาน (group) shows **% = children complete / total** via `deriveDeliverableProgress` (`src/lib/work-packages/group-roster.ts`); the group's own status pill is a DB-rollup truth source.
- A worker links to WPs through the **team they were mustered into**: `muster_attendance(worker_id, team_id, work_date)` → `muster_teams` → `muster_team_wps(team_id, work_package_id)` (`supabase/migrations/…075750_spec306u2_muster_schema.sql`). `muster_team_wps` rows are MAIN WPs (งาน) by convention, with sub-WP overrides.
- Muster read RLS is **project-membership** (`can_see_project`) — a technician is not a project member, so cannot read these tables directly. **Hence a self-scoped RPC** (not a policy change).

## Design

### U1 — `get_my_assigned_work()` — self-scoped read RPC (schema, operator-merged)

A `SECURITY DEFINER` read function, self-scoped to the caller:

- `auth.uid()` → `workers.id` (via `workers.user_id`) → the caller's **latest** `muster_attendance` row (max `work_date`) → its `team_id` → `muster_team_wps` → the assigned WPs.
- Returns per assigned WP the fields to render a row **plus** progress: `id, code, name, is_group, status, work_date`, and for the progress %:
  - group row → its children's `complete_count` / `total_count`;
  - leaf row → its `parent_id` + parent `code`/`name` + the parent's `complete_count` / `total_count`.
- Read-only. **No money, no writes.** `revoke … from anon`; `grant execute … to authenticated`; body self-scopes to the caller's own team, so no cross-worker leak (a technician who is not a project member still only ever sees their own team's WPs).
- Empty result when: no worker row, no muster attendance, or the team has no WPs set.

### U2 — the card (code-only)

- Replace the placeholder card in `src/app/technician/page.tsx` with a real list rendered from `get_my_assigned_work()` (server-component read on the RLS **session** client, never admin).
- Per WP row: code + name, status pill (`status-icons`), and progress context:
  - งาน (group) → `X% (n/m งานย่อย เสร็จ)`
  - งานย่อย (leaf) → status + `อยู่ในงาน <parent> · X%`
- Reuse `deriveDeliverableProgress` for the %.
- **Read-only** — no status edits (that stays PM/SA).
- Card header carries the `work_date` so "วันนี้ / ล่าสุด" is honest (today's team vs last mustered day).
- Empty state: `ยังไม่มีงานที่ได้รับมอบหมาย`.

## Non-goals (YAGNI / scope guards)

- No attendance display, no money/earnings, no OT — the separate spec-306 track.
- No actions (no status change, photo, or capture) — ADR 0074 keeps งาน oversight-only; this is a read.
- No persistent worker↔WP assignment model — assignment stays day-scoped via muster.
- No worker self-check-in — capture stays SA-scanned.

## Open questions

- "Most-recent team" = today if mustered today, else last mustered day. **Chosen default** (rejected the running-history lens). Revisit only if a multi-day "current jobs" list is wanted.
- Drill-in to a งาน's sub-WP breakdown from the card? **v1 = top line only.**

## Units

| Unit | Scope | Class |
|---|---|---|
| U1 | `get_my_assigned_work()` self-scoped read RPC + pgTAP | schema — operator-merged |
| U2 | `/technician` card + progress view-model + vitest | code-only |

## Verification

- **pgTAP (U1):** returns only the caller's latest-team WPs; empty for a non-worker / no-attendance caller; a second worker's team never leaks; group vs leaf rows carry the right progress counts.
- **vitest (U2):** progress view-model (group %, leaf's parent %), empty state, work-date header.
- **Real-flow:** dev-preview bound as a technician with a muster attendance row → card renders the team's WPs + % with zero console errors.
