# Spec 156 — Edit a work package's name

ADR 0059 §2 (+ ADR 0056 membership, ADR 0058 director).

## Locked design (operator, 2026-06-20)

`name` and `code` are create-only today. The operator wants to fix/rename a WP.
This unit makes **`name`** editable via a per-field RPC (mirrors
`set_work_package_notes`). **`code` stays immutable** for now (business key across
PR cards / reports / lists; uniqueness re-validation + cross-surface impact →
deferred to its own unit, ADR 0059 §2).

- **RPC** `set_work_package_name(p_work_package_id uuid, p_name text)` — SECURITY
  DEFINER, pinned `search_path`, returns `boolean` (false on unknown WP).
  - Gate: `current_user_role() in ('project_manager','super_admin','project_director')`
    → else `42501`. Plus `can_see_wp(p_work_package_id)` → else `42501` (ADR 0056).
  - Validate: `p_name` trimmed non-empty + length CHECK (reuse the WP-name bound
    from `create_work_package`) → else `22023` / `23514`.
  - No audit row (benign, ADR 0059 §6). Allowed on closed projects (ADR 0059 §5).
- **Server action** + `revalidatePath`; gate mirrors the RPC.
- **UI**: an "แก้ไขงาน" edit affordance on the WP-detail header (PM/super/director
  only; hidden for site_admin + the read-only coordinator). A small edit sheet
  (single name field, save lifecycle บันทึก → กำลังบันทึก… → บันทึกแล้ว), modeled
  on the project [settings-form](../src/app/projects/[projectId]/settings/settings-form.tsx)
  (ADR 0042). Name follows the spec-57 no-truncate rule on display.
- `database.types.ts` regenerated after `db:push` + `db:types`.

## TDD

Failing tests first.

1. **pgTAP** `NN-set-work-package-name.test.sql`: catalog; PM renames →
   `name` updated; `super_admin` + `project_director` allowed; `site_admin` +
   `visitor` denied (`42501`); blank/whitespace name rejected (`22023`);
   over-long name rejected (`23514`); unknown WP → false; non-member PM denied
   (`42501`).
2. **vitest** for the edit sheet (pre-fills current name; submits the new name;
   blank disables save).

## Scope — IN

1. Migration: `set_work_package_name` RPC.
2. Server action + WP-detail edit sheet (PM/super/director).
3. The two tests.

## Scope — OUT (open questions)

- **Edit `code`** — sensitive business key; needs uniqueness re-validation
  (`23505`) + an audit of every surface that shows a code. Own unit, pending
  operator sign-off (ADR 0059 §2).
- A unified multi-field WP-settings page — not needed; per-field RPCs +
  the existing inline editors cover the surface.

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:push && pnpm db:test`
  (+ `pnpm db:types`) — all green.
- Live: a PM renames a WP from its detail page → the new name shows on the
  detail, the project WP list, and any request referencing it. SA sees no edit
  affordance.
