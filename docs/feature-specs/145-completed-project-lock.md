# Spec 145 — Lock new work on a completed project (warranty-aware)

Operator (2026-06-18): a project locks once completed. **Caveat that shapes the
design:** completion is NOT full closure — the client retains a warranty %
(Buildall keeps 5% for a year), and defects surface during that warranty window.
So the lock must block **new work** but must NOT block **warranty defect-rework**
(spec 144's reopen path).

## Decision

- **`completed` and `archived` are "closed"; `active`/`on_hold` are "open".**
- A closed project **rejects new work packages** (every creation path: manual /
  template / copy / CSV).
- A closed project **still allows warranty defect-rework**: `reopen_work_package_for_defect`
  (spec 144) reopens a complete WP to `rework`, and the reworked WP's
  capture/labor/approval cycle proceeds — because the reopen is an UPDATE and
  those writes gate on **WP** status, not project status.
- The **project record stays editable** (status can move `completed → active` to
  reopen the whole project; warranty/retention notes can be recorded in
  settings).
- **Out of scope (deliberately):** the retention % / warranty-period billing is
  a finance concern the app resists (status-only billing at most, per the CEO
  review) — not built here. This spec is the operational lock only.

## Implementation (one unit — DB lock + UI)

- **`project_is_open(uuid)`** SECURITY DEFINER STABLE — `status in (active,
on_hold)`.
- **`work_packages_block_insert_on_closed_project`** — a `BEFORE INSERT` trigger
  on `work_packages` raising `P0002` when the target project isn't open. One
  chokepoint catches every WP-creation path without touching the three creation
  RPCs. **INSERT-only**, so reopen-to-rework (an UPDATE) and the rework cycle are
  untouched — the warranty carve-out falls out for free.
- **Action error-mapping:** `createWorkPackage` / `copyWorkPackages` /
  `applyWpTemplate` / `importWorkPackagesCsv` map `P0002` → "โครงการนี้ปิดแล้ว
  เปิดโครงการก่อนจึงจะเพิ่มหรือนำเข้างานได้".
- **UI (project page):** when the project is closed, hide the seeding controls
  (add / template / copy / import) and the onboarding checklist, and show a lock
  banner that points to settings to reopen. Defect-rework stays on each WP page.
- **pgTAP file 76** (plan 11): helper truth table; direct insert + all three
  RPCs blocked on a completed project (`P0002`); create still works on an active
  project; **reopen-for-defect still works on a completed project** (the warranty
  assertion). Fixtures seed WPs while the project is active, then flip it
  completed (so the seed doesn't trip the new trigger).

## Lifecycle, now complete

`active/on_hold` (full edit) → `completed` (locked for new work; warranty window:
defects reopen individual WPs to `rework` → fix → re-approve → complete) →
`archived` (also closed). Reopen the whole project by setting status back to
`active` in settings.
