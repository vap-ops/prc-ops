# Spec 165 — งวดงาน (deliverable) lifecycle: edit, reorder, detail

**Status:** In progress (U1).
**Relates to:** ADR 0016 (deliverables entity — code/name/sort_order only;
amount/status/dates OUT), ADR 0059 (WP mutation lifecycle — the mirror), Spec 164
(create + map + onboard), Spec 156 (edit WP name), Spec 157 (delete empty WP).

## Problem

Spec 164 made งวด creatable, mappable, and onboarded — but a งวด, once made, is
immutable from the app: you can't fix a typo'd name, reorder it, or open it to
see its งาน. The follow-ups operator asked for ("add them"):

1. Rename a งวด.
2. Reorder งวด.
3. A งวด detail page.
4. Archive/retire a งวด.
5. Tie a งวด to billing amount/dates.

## Scope split

(1)(2)(3) are additive and within ADR 0016 (they only touch name/sort_order or
are read-only UI). (4) and (5) add `status`/`amount`/`dates` — fields ADR 0016
**explicitly excludes** — so they need an ADR 0016 amendment decision before
build (CLAUDE.md: architectural changes are raised, not improvised), and (5)
also interacts with Spec 149 client_billings (the งวด billing already lives
there). Those two are tracked as pending-ADR, not built blind.

## Unit map

- **U1 — rename a งวด (DONE 2026-06-21).** `set_deliverable_name` RPC + per-row
  edit sheet in the DeliverablesManager. Mirrors Spec 156.
- **U2 — reorder งวด.** Move up/down by swapping `sort_order` with the neighbour
  (`swap_deliverable_order` RPC) + ▲▼ controls in the manager.
- **U3 — งวด detail page.** `/projects/[projectId]/deliverables/[deliverableId]`
  — งวด header + its งาน list + the edit/reorder/remove actions in one place.
- **U4 — remove + delete (operator: "delete empty only, add a WP removal
  workflow").** A way to remove/ungroup งาน from a งวด (bulk un-assign →
  `set_work_package_deliverable(null)`, the reverse of U3-164's funnel), which
  lets a งวด become empty; then `delete_deliverable` for an EMPTY งวด only (no
  งาน bound) — mirrors Spec 157's delete-empty-WP. **Needs an ADR 0016 amendment**
  (the table's no-DELETE contract gains a delete-empty exception, as ADR 0059 did
  for WPs).
- **U5 — งวด ↔ billing link (operator: "link to billing, spec 149").** Connect a
  งวด to `client_billings` (Spec 149 already bills per งวด + retention) so amount
  and dates have ONE source of truth, GL-aware — not duplicated fields on
  `deliverables`. **Needs an ADR 0016 amendment + a Spec 149 integration design**
  (its own design pass; the heaviest piece).

Decisions recorded 2026-06-21 (operator): archive = delete-empty + งาน-removal
(NOT a status column); money/dates = link to Spec 149 (NOT fields on งวด).

---

## U1 — rename a งวด

### DB — `set_deliverable_name(p_deliverable_id uuid, p_name text) returns boolean`

SECURITY DEFINER, `set search_path = public`. Mirrors `set_work_package_name`
(Spec 156), membership-gated via `can_see_project` (deliverables have no
`can_see_*` of their own; the งวด's project is the unit of visibility):

- Role gate: `current_user_role() in ('project_manager','super_admin','project_director')` → else 42501.
- Look up the งวด's `project_id`; unknown id or `not can_see_project(project_id)` → 42501 (mirrors the can_see_wp-first behaviour: a missing/invisible row is 42501, not a silent false).
- Trim name; non-empty and ≤ 200 → else 22023.
- `update deliverables set name … where id`; return `found`.
- `code` stays immutable (cross-surface business key, like WP code). No audit (benign edit, ADR 0059 §6).
- Grants: revoke public/anon; grant authenticated.

### App

- `setDeliverableName({ projectId, deliverableId, name })` action (PM_ROLES gate,
  reuse `validateDeliverableName`, 42501/22023 map, `revalidatePath`).
- `EditDeliverableSheet` — a per-row "แก้ไข" button → bottom sheet (name field,
  code shown read-only) → save → refresh. Rendered in each DeliverablesManager row.

### Acceptance

- A PM/super/director member renames a งวด from the manager; the list updates.
- Empty / over-long name rejected; non-member / non-PM cannot rename.

### Out of scope (this unit)

- Reorder (U2), detail page (U3), archive + amount/dates (pending ADR).
