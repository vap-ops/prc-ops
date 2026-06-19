# Spec 155 — Bind a work package to a deliverable (งวดงาน)

ADR 0059 §1 (+ ADR 0016 deliverables, ADR 0056 membership, ADR 0058 director).

## Locked design (operator, 2026-06-20)

`work_packages.deliverable_id` exists (nullable FK → `deliverables(id)` ON DELETE
SET NULL) and the deliverable lens already groups by it — but there is **no write
path** to set it after create. New in-app WPs are always ungrouped (ยังไม่จัดกลุ่ม).
This unit adds the post-create bind/move/clear action, mirroring the per-field RPC
pattern (`set_work_package_priority`).

- **RPC** (own migration): `set_work_package_deliverable(p_work_package_id uuid,
p_deliverable_id uuid default null)` — SECURITY DEFINER, pinned `search_path`,
  returns `boolean`. `p_deliverable_id` carries `default null` so typegen marks
  the arg optional and the action omits it to ungroup (the
  `set_work_package_schedule` idiom). The membership gate runs FIRST, so an
  unknown WP id yields `42501` (`can_see_wp` is false for a missing WP — existence
  isn't disclosed to non-members), not a false return.
  - Gate: `current_user_role() in ('project_manager','super_admin','project_director')`
    → else `42501`. Plus membership: `can_see_wp(p_work_package_id)` → else `42501`
    (ADR 0056, `reopen` precedent).
  - Validate: `p_deliverable_id IS NULL` → clear (ungroup). Non-null → the
    deliverable must exist AND `deliverable.project_id = work_package.project_id`
    → else `22023` (cross-project / unknown deliverable rejected).
  - No audit row (benign metadata, ADR 0059 §6).
  - Allowed on closed projects (UPDATE, not INSERT — ADR 0059 §5).
- **Server action** wrapping the RPC + `revalidatePath` of the project page; gate
  mirrors the RPC (`PM_ROLES.includes` + manager check).
- **UI**: a deliverable picker on the WP-detail page, beside the existing
  priority/contractor editors. Options = this project's deliverables (`code · name`,
  `sort_order` then code) + a "ยังไม่จัดกลุ่ม" clear option. PM/super/director only;
  hidden for site_admin (and the read-only coordinator, spec 154). Use the shared
  `FieldSelect` primitive; the WP-detail loader already has the project's
  deliverables (or add a scoped read).
- `database.types.ts` regenerated after `db:push` + `db:types`.

## TDD

Failing tests first.

1. **pgTAP** `NN-set-work-package-deliverable.test.sql`: catalog (function exists,
   SECURITY DEFINER); PM binds → `deliverable_id` set; bind `NULL` → cleared;
   `super_admin` + `project_director` allowed; `site_admin` + `visitor` denied
   (`42501`); a deliverable from ANOTHER project rejected (`22023`); an unknown
   deliverable rejected (`22023`); a PM who cannot see the WP (non-member,
   membership gate) denied (`42501`).
2. **vitest** for the picker component (renders the project's deliverables + the
   clear option; calls the action with the chosen id / null).

## Scope — IN

1. Migration: `set_work_package_deliverable` RPC.
2. Server action + WP-detail deliverable picker (PM/super/director).
3. The two tests.
4. `docs/site-map.md` if the WP-detail action surface is documented there.

## Scope — OUT (open questions)

- `create_deliverable` (in-app งวดงาน creation/rename/reorder) — its own spec;
  until it ships, binding is inert on in-app-created projects (ADR 0059 §1).
- Deliverable at CREATE time (extend `create_work_package` + add-WP-sheet picker)
  — follow-up unit (signature change → DROP+CREATE + grep pins).
- Bulk re-bind / drag-between-groups UI — later.

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:push && pnpm db:test`
  (+ `pnpm db:types`) — all green.
- Live: a PM opens a WP, picks a งวดงาน → the WP moves into that group in the
  deliverable lens; picks "ยังไม่จัดกลุ่ม" → it leaves. SA sees no picker.
