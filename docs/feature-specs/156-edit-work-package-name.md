# Spec 156 — Edit a work package's name

ADR 0059 §2 (+ ADR 0056 membership, ADR 0058 director).

## Locked design (operator, 2026-06-20)

`name` and `code` are create-only today. The operator wants to fix/rename a WP.
This unit makes **`name`** editable via a per-field RPC (mirrors
`set_work_package_notes`). **`code` stays immutable** for now (business key across
PR cards / reports / lists; uniqueness re-validation + cross-surface impact →
deferred to its own unit, ADR 0059 §2).

- **RPC** `set_work_package_name(p_work_package_id uuid, p_name text)` — SECURITY
  DEFINER, pinned `search_path`, returns `boolean`. The membership gate runs first,
  so an unknown WP id yields `42501` (`can_see_wp` is false for a missing WP).
  - Gate: `current_user_role() in ('project_manager','super_admin','project_director')`
    → else `42501`. Plus `can_see_wp(p_work_package_id)` → else `42501` (ADR 0056).
  - Validate: `p_name` trimmed non-empty, `<= 200` chars — the exact bound from
    `create_work_package` → else `22023`.
  - No audit row (benign, ADR 0059 §6). Allowed on closed projects (ADR 0059 §5).
- **Server action** + `revalidatePath`; gate mirrors the RPC.
- **UI**: an inline name editor (single-line field + Save, toasted) in the
  manager-only management block beside priority / deliverable / schedule —
  PM/super/director only; hidden for site*admin + the read-only coordinator. The
  header keeps the read-only nameplate (spec-57 no-truncate). *(Built inline in
  the management block rather than a header sheet — consistent with the sibling
  controls and lower-risk; the header stays the nameplate.)\_
- `database.types.ts` regenerated after `db:push` + `db:types`.

## TDD

Failing tests first.

1. **pgTAP** `93-set-work-package-name.test.sql`: catalog; PM renames →
   `name` updated (trimmed); `super_admin` + `project_director` allowed (see-all);
   `site_admin` + `visitor` denied (`42501`); blank/whitespace rejected (`22023`);
   over-long (> 200) rejected (`22023`); non-member PM denied (`42501`).
2. **vitest** for the inline control (renders current name; Save disabled until a
   trimmed change; clicking Save calls the action with the trimmed value; blank
   keeps Save disabled).

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
