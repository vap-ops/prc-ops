# Spec 157 — Delete a work package (Tier 1: empty-only hard delete)

ADR 0059 §3 (+ ADR 0004/0015 immutability, ADR 0056 membership, ADR 0058 director).

## Locked design (operator, 2026-06-20)

There is no delete path today (no DELETE RLS policy → app-path delete is a silent
no-op). A destructive delete is doctrinally wrong AND mechanically blocked: a WP's
`photo_logs` + `approvals` CASCADE but carry append-only `BEFORE DELETE` triggers
(`P0001`); `labor_logs.work_package_id` is a bare column (would orphan). So Tier 1
is the **safe, real** case: a WP created by mistake, with **no captured evidence**,
is hard-deleted; anything with history goes to Tier 2 **cancel** (deferred — its
own spec, ADR 0059 §3).

- **RPC** `delete_work_package(p_work_package_id uuid)` — SECURITY DEFINER, pinned
  `search_path`, returns `boolean`.
  - Gate: `current_user_role() in ('project_manager','super_admin','project_director')`
    → else `42501`. Plus `can_see_wp(p_work_package_id)` → else `42501`.
  - **Empty guard:** raise `P0001` if ANY child row exists for the WP —
    `photo_logs`, `labor_logs`, `approvals`, `purchase_requests`,
    `work_package_members`, schedule dependencies (predecessor OR successor).
    (Because we refuse when children exist, the CASCADE / append-only-trigger /
    orphan conflict never fires.)
  - On pass: `delete from work_packages where id = p_work_package_id` (SECURITY
    DEFINER owner can delete; no DELETE RLS policy is added — the RPC is the only
    entry point). Unknown WP → false.
  - **Audit row** (`event: 'wp_deleted'`, the WP code/name in payload) — ADR 0059 §6.
  - Allowed on closed projects (ADR 0059 §5).
- **No `labor_logs` FK migration needed.** _(Correction: the earlier read
  mis-flagged `labor_logs.work_package_id` as a bare column. It already has an FK
  (NO ACTION) that blocks deleting a referenced WP (`23503`) — a backstop the
  empty-guard sits in front of.)_
- **Server action** + `revalidatePath` of the project page; gate mirrors the RPC.
  Maps the RPC's `P0001` to the "cancel instead" message.
- **UI**: a destructive "ลบงาน" action in the manager-only management block on the
  WP-detail page (PM/super/director; hidden for site_admin + read-only
  coordinator), behind the themed `ConfirmDialog` (no `window.confirm` —
  ui-conventions §7). On success it navigates to `/projects/[id]` (the WP is gone,
  so `router.refresh` would 404). If the WP is non-empty the RPC raises `P0001` →
  the inline "ลบไม่ได้ — งานนี้มีรูป แรงงาน หรือคำขอซื้อแล้ว" message points at the future
  cancel path.
- `database.types.ts` regenerated after `db:push` + `db:types`.

## TDD

Failing tests first.

1. **pgTAP** `94-delete-work-package.test.sql`: catalog; the pre-existing
   `labor_logs → work_packages` FK blocks delete (NO ACTION/RESTRICT); PM deletes
   an EMPTY WP → row gone + one `audit_log` row; `super_admin` + `project_director`
   allowed (see-all); WP with a `photo_log` / `labor_log` / `purchase_request` →
   `P0001` (refused, survives); `site_admin` + `visitor` denied (`42501`);
   non-member PM denied (`42501`).
2. **vitest** for the delete confirm UI (confirm → action called → navigates to
   the project page; the non-empty error renders the cancel-instead message + no
   navigation).

## Scope — IN

1. Migration: `delete_work_package` RPC. _(No `labor_logs` FK migration — it
   already exists.)_
2. Server action + WP-detail delete action (confirm-gated, PM/super/director).
3. The two tests.

## Scope — OUT (open questions)

- **Tier 2 — `cancel`/`restore` for WPs WITH history** (the `cancelled` status
  value + exclusion from lenses/progress). Its own spec; needs the enum-add
  migration + every status-exhaustive switch (ADR 0059 §3).
- Cascade/bulk delete; un-delete of a hard-deleted WP (gone is gone — that is
  exactly why Tier 2 exists for anything with history).

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:push && pnpm db:test`
  (+ `pnpm db:types`) — all green.
- Live: a PM creates a throwaway WP, deletes it from its detail page → returns to
  the project list, WP gone. A WP with photos refuses with the "use cancel"
  message. SA sees no delete action.
