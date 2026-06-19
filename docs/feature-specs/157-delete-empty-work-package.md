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
- **Adjacent fix (own migration):** add the missing FK
  `labor_logs.work_package_id → work_packages(id)` (ON DELETE RESTRICT — the empty
  guard already prevents reaching it; RESTRICT is the integrity backstop). This
  closes the schema-oversight orphan risk ADR 0059 §Consequences flags.
- **Server action** + `revalidatePath` back to the project page; gate mirrors the
  RPC. After delete, redirect to `/projects/[id]`.
- **UI**: a destructive "ลบงาน" action on the WP-detail page (PM/super/director;
  hidden for site_admin + read-only coordinator), behind `ConfirmDialog` /
  `ConfirmActionButton` (no `window.confirm` — ui-conventions §7). If the WP is
  non-empty the RPC raises; surface a Thai message ("ลบไม่ได้ — งานนี้มีรูป/แรงงาน/คำขอซื้อแล้ว
  ใช้การยกเลิกแทน") pointing at the future cancel path.
- `database.types.ts` regenerated after `db:push` + `db:types`.

## TDD

Failing tests first.

1. **pgTAP** `NN-delete-work-package.test.sql`: catalog; PM deletes an EMPTY WP →
   row gone, returns true; `super_admin` + `project_director` allowed;
   `site_admin` + `visitor` denied (`42501`); WP with a `photo_log` → `P0001`
   (refused); WP with a `labor_log` → `P0001`; WP with a `purchase_request` →
   `P0001`; unknown WP → false; non-member PM denied (`42501`); one `audit_log`
   row written on success; `labor_logs` FK exists + is `RESTRICT`.
2. **vitest** for the delete confirm UI (confirm → action called; the non-empty
   error renders the cancel-instead message).

## Scope — IN

1. Migration: `labor_logs.work_package_id` FK (own migration).
2. Migration: `delete_work_package` RPC.
3. Server action + WP-detail delete action (confirm-gated, PM/super/director).
4. The two tests.

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
