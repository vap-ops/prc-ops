# Spec 164 — งวดงาน (deliverable) create + map UX

**Status:** In progress (U1).
**Relates to:** ADR 0016 (deliverables entity), ADR 0059 (WP mutation lifecycle —
deferred `create_deliverable`), Spec 155 (bind WP→deliverable), Spec 142
(project onboarding), Spec 163 (paste WPs).

## Problem

Operators can't figure out งวดงาน (deliverables — the client billing milestones
that group work packages) because the feature is half-built:

1. **There is no way to create a งวดงาน in the app.** `create_deliverable` was
   deferred (ADR 0059 §1). Every งวด that exists got there from a one-time SQL
   seed (`seed-deliverables.sql`) of the two pilots. A project created in-app
   (or the freshly-imported 262-WP project) has zero งวด and no button to make
   one. → "not even clear where to add the deliverables itself."
2. **Mapping is per-WP only and backwards.** The single mapping path is the
   `<select>` on each WP's detail page (Spec 155). Grouping 262 WPs into ~30 งวด
   means 262 page visits. No bulk, no "pick งาน for this งวด". → "doesn't know
   how to map WP with deliverables."
3. **งวด has no home.** No `/deliverables` surface, no detail, no section on the
   project page — งวด appears only as grouping headers inside the WP list.
   Onboarding never mentions it.

## Direction (operator, 2026-06-21)

"Both, import-first" — and the งวด is **not** in the WP sheet column. So:
creation is **import-first via a pasted งวด list** plus an in-app manager;
mapping is **in-app** (multi-select), since the งาน→งวด link isn't in the sheet.

## Unit map

- **U1 — create งวดงาน in-app (this unit).** `create_deliverable` RPC +
  a "งวดงาน" manager section on the project page with **เพิ่มงวด** (add one).
  Gives the concept a home and the missing door.
- **U2 — bulk-paste a งวด list.** A paste box (`D01⇥name` per line) that loops
  the create RPC — the Spec 163 pattern, targeting deliverables.
- **U3 — map งาน→งวด in bulk.** Multi-select assign from a งวด (and a
  "ยังไม่จัดกลุ่ม" funnel banner) → loops `set_work_package_deliverable`.
- **U4 — onboarding nudge.** Checklist item + an ungrouped-WP banner.

---

## U1 — create งวดงาน in-app

### DB — `create_deliverable(p_project_id uuid, p_code text, p_name text) returns uuid`

SECURITY DEFINER, `set search_path = public`. Mirrors `create_work_package`
(Spec 142 U4) with the Spec 155 / 152 gate:

- Role gate: `current_user_role() in ('project_manager','super_admin','project_director')` → else 42501.
- Validate: trimmed code non-empty and ≤ 50; trimmed name non-empty and ≤ 200 → else 22023.
- Project must exist → else 22023.
- `sort_order` auto-assigned = `coalesce(max(sort_order),0)+1` for that project
  (new งวด lands at the end; matches the seeded D01..D30 ordering intent).
- Insert into `deliverables (project_id, code, name, sort_order)`, return `id`.
- Duplicate `(project_id, code)` raises 23505 for the UI to surface.
- Grants: `revoke all … from public, anon; grant execute … to authenticated`.

No closed-project block (unlike WP create): adding a งวด is benign metadata,
and binding is already allowed on closed projects (ADR 0059 §5).

### App

- `src/lib/deliverables/validate-new-deliverable.ts` — `DELIVERABLE_CODE_MAX=50`,
  `DELIVERABLE_NAME_MAX=200`, `validateDeliverableCode/Name` (form fast-feedback;
  the RPC re-checks).
- `createDeliverable({ projectId, code, name })` server action in the project
  `actions.ts` — PM_ROLES gate, calls the RPC, maps 23505→"รหัสงวดนี้มีอยู่แล้ว",
  42501→PM-only, 22023→invalid; `revalidatePath`.
- `AddDeliverableSheet` — "+ เพิ่มงวด" → bottom sheet (code + name), mirrors
  `AddWorkPackageSheet`.
- `DeliverablesManager` — a "งวดงาน" section on the project page (PM-only, open
  projects) listing each งวด (`code · name · N งาน`, sorted by sort_order) with
  the add button; empty state when none. Placed above the "รายการงาน" section.

### Acceptance

- A PM/super/director can add a งวด from the project page; it appears in the
  manager list and as a group option in the "ตามงวดงาน" lens / WP picker.
- Duplicate code is rejected with a clear message; non-PM cannot add.
- New งวด gets the next sort_order.

### Out of scope (later units / specs)

- Bulk paste (U2), bulk งาน→งวด mapping (U3), onboarding nudge (U4).
- Rename / reorder / archive a งวด; งวด detail page; amount/status/dates
  (ADR 0016 keeps those out).
