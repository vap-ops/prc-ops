# Spec 335 — เพิ่มงานย่อย from the งาน (main WP) detail

**Status:** operator directive 2026-07-21 — "add เพิ่มงานย่อย button in main WP
detail view". Single code-only unit (U1). No schema.

## Problem

Spec 270 D6 made grouping mandatory: in an adopted project every งานย่อย must
sit under a งาน, and the DB guard (`wp_hierarchy_guard`, mig `072500`) rejects a
parentless insert. The only place to create one is the project page's
`+ เพิ่มงาน` sheet, which therefore asks for the parent through a select that is
47 options long on the live data.

The งาน detail (`GroupDetailView`, spec 270 U4) is where a manager actually
reads a งาน's children — code, name, status, n/m เสร็จ. It is the one screen that
already knows the parent, and it has no way to add a child. So the flow today is:
open งาน → see a gap → go back to the project → open the sheet → find that งาน
again in a 47-option list.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Gate = `isManagerRole` AND project open.** `isManagerRole` is exactly `PM_ROLES`, which is exactly what `createWorkPackage` enforces — the button and the action share one definition, so the affordance can never be a dead door. Project-open (`active`/`on_hold`) mirrors the project page; the RPC's `P0002` would otherwise be the only feedback. No new role set.                                                                                                                                   |
| D2  | **One door, in the children section header** — beside `งานย่อยในงานนี้ (N)`. Not repeated in the empty state.                                                                                                                                                                                                                                                                                                                                                                                               |
| D3  | **No parent picker.** The งาน being viewed IS the parent; the sheet renders it as static context. Same `AddWorkPackageSheet` component in a `fixedParent` mode, so both entry points keep one validation path, one server action, one error map.                                                                                                                                                                                                                                                            |
| D4  | **Code prefilled with `<parent code>-`.** Evidence: all **331** live child WPs under all **47** parents carry the parent code as prefix (queried 2026-07-21). Prefill is a default, not a rule — the field stays editable and the DB has no prefix constraint. It costs one guard: `WP-05-` alone passes the non-empty validator, so `canSubmit` also requires the code to differ from the bare prefix — otherwise the prefill would silently retire the "an untouched code field cannot submit" behaviour. |
| D5  | **A งาน stays oversight-only.** This adds a STRUCTURE affordance (create a child row), not capture/status/priority/money. ADR 0074 and the operator's 2026-07-06 directive are unchanged: no photos, no manual status, no money writes on a งาน.                                                                                                                                                                                                                                                            |

## Unit U1 (code-only)

- `add-work-package-sheet.tsx`: optional `fixedParent?: { id; code; name }`. When
  set — the parent select is replaced by static context, the trigger reads
  `+ เพิ่ม{WP_LEAF_LABEL}`, the sheet title `เพิ่ม{WP_LEAF_LABEL}`, and `code`
  starts at `` `${fixedParent.code}-` ``. Unset — byte-identical to today.
- `group-detail-view.tsx`: optional `addChildAction?: ReactNode` slot rendered in
  the children section header. Stays server-safe (no hooks).
- The WP detail page's `is_group` branch computes the gate and passes the sheet.
  The `projects.status` read is planner-only and rides the children read's
  `Promise.all` — the group branch gains no serial hop.
- Labels compose from `WP_LEAF_LABEL` (ui-term-consistency doctrine) — no new
  literal.

## Testing

- `group-detail-view.test.tsx`: the slot renders in the children section's own
  header row (placement, not mere presence); no door when none is passed.
- `add-work-package-sheet.test.tsx`: fixed-parent mode is rendered WITH `groups`
  so that the fixed parent's precedence over the picker is actually asserted —
  no select, the sheet titled `เพิ่มงานย่อย`, the code prefilled, submit held at
  the bare prefix, and `parentId` = the viewed งาน on the payload. Default mode's
  three existing tests are the regression pin.
- `wp-group-add-child-gate.test.ts`: source pin on the page's gate — `isPlanner`
  (never the wider `isAssigner`), both open statuses, and the sheet rendered only
  under `canAddChild`. The gate has no render test, so this is what stops a
  future edit widening it silently.
- Real flow: the งาน detail served as a PM (door present) and as a non-PM via
  spec-274 view-as (door absent, page otherwise identical); a real งานย่อย
  created through `create_work_package` under the dev-preview identity, seen to
  render (1 → 2), then removed with `delete_work_package` (2 → 1).
