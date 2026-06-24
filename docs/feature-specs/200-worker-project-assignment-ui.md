# Spec 200 — Assign a worker to a project (the missing UI)

**Why:** operator asked "how do we assign DC workers to projects?" The answer was
**you can't from the app** — the engine exists (`assign_worker_to_project` RPC +
`workers.project_id`, one project at a time, audit trail; migrations 20260756 / 20260796) but `/workers` only created / edited / set-rate / invited. A worker had
no project unless set directly in the DB. Assignment isn't required to _log
labour_ (the picker lists everyone, ordering the project's crew first), but it
powers the `/store` custody-receiver picker (strict project filter) and the
labour-picker ordering — so the missing UI is a real gap.

**Decision:** surface the existing engine on `/workers`. No DB change.

## Unit (single)

- `assignWorkerToProject({ workerId, projectId })` action (`src/app/workers/actions.ts`)
  — relays to the `assign_worker_to_project` definer RPC (gate PM / super /
  director / procurement; the same `WORKER_ROSTER_ROLES` that reach this page). A
  `""`/null project unassigns (the RPC's `p_project` defaults to null → cleared).
- `WorkerRosterManager` (`worker-roster-manager.tsx`):
  - `ManagedWorker` gains `project_id: string | null`; a new `projects` prop
    (`AssignableProject[]`, default `[]`) lists the assignable projects.
  - Each worker row shows its **current project** (or "ยังไม่ระบุโครงการ").
  - The per-row edit sheet gains a **โครงการ** `<select>` (ไม่ระบุ + each project);
    on save, a changed project calls `assignWorkerToProject` (one project at a
    time — reassigning moves it + appends the move trail in the RPC).
- `/workers` page reads `workers.project_id` (admin client, with the rest of the
  roster) + the assigner's RLS-scoped projects, and passes both down.

### U2 — assign at creation

So a new DC is scoped to their project on day one (no second step).

- The **add-worker form** gains the same optional **โครงการ** `<select>`.
- `createWorker` now captures the new worker's id and, when a project was chosen,
  calls `assign_worker_to_project` — a **create + assign**, reusing the existing
  RPC. **No DB change** (avoids widening `create_worker`'s signature). The assign
  is soft: the worker exists either way; a failed assign returns a message and the
  project can still be set from the row's edit sheet.

## Out of scope

- No change to the assignment model (single `workers.project_id`, not a
  multi-project join) or the RPCs.
- Labour logging already works without assignment (unchanged).
