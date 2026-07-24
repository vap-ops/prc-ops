# Spec 352 — ถอนงานกลับมาแก้ไข: recall a submitted WP to fix its evidence

**Status:** operator directive 2026-07-24 — _"WO-04-47 images are placed wrongly,
delete them first, then enable me to do so without your help."_ The three
misplaced photos on WP-04-47 were removed as a one-off admin data op (append-only
tombstones, ADR 0015; originals + storage intact). This spec builds the
self-serve path so the operator never needs that help again. Two units — U1
schema, U2 code.

## Problem

Photo removal on a `pending_approval` work package is frozen. `photo_wp_deletable`
returns `status NOT IN ('pending_approval','complete')`, and the only unlock at
`pending_approval` is an _open_ ให้แก้ไข window (a `needs_revision` decision not yet
answered by `wp_evidence_resubmitted`). That freeze is deliberate — specs 291/340
keep it so a reviewer can never approve evidence that shifted underneath them
after they last looked.

The gap is the **fresh, undecided submission**: an SA submits a WP too early, or
with photos placed on the wrong WP, and it sits in the review queue. Nobody —
not the uploader, not even super_admin — can fix the evidence. The only path is
to make a reviewer press ให้แก้ไข first, which charges the WORK a revision cycle
for a PHOTO-only mistake and needs a second person. The operator hit exactly this
on WP-04-47 (`pending_approval`, zero decisions) and had to ask for a direct-DB
removal.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Recall the submission; never weaken the freeze.** A new affordance pulls an in-review WP back to `in_progress`, where the existing remove/add-photo flow already works (`photo_wp_deletable` admits it); the SA fixes the evidence and re-submits. The evidence-integrity invariant is preserved _because_ changing photos now requires first taking the WP **out** of review — a visible, audited status change — instead of a silent in-place edit. Recall is the honest inverse of ส่งงานเข้าตรวจ, not a back door into the freeze.                     |
| D2  | **One new DEFINER RPC `recall_work_package_submission(p_wp)`**, mirroring `submit_work_package_for_approval`: runs on the CALLER's session (no admin-client escalation), so the existing `work_packages_transition_audit` trigger stamps the actor and `from_status='pending_approval' → to_status='in_progress'`. **No new audit event** — that from/to pair is produced by nothing but a recall, so the WP history reads it unambiguously and reviewers/SA see who pulled it back.                                                                         |
| D3  | **Authority = the original submitter, or super_admin** (operator call 2026-07-24). The submitter is **derived, not stored**: the actor of the most-recent `wp_status_transition` audit row into `pending_approval` (spec 337 U1 attributed transitions already record it). No new column. Fail closed: a pre-337 submission whose actor is NULL is recallable by super_admin only.                                                                                                                                                                           |
| D4  | **Recallable whenever `pending_approval` AND the revision window is CLOSED** (operator call 2026-07-24). Fresh submit → recallable; re-submit after a prior cycle → recallable; an OPEN ให้แก้ไข window → NOT recallable (there the spec-291 in-place removal applies — less disruptive, stays in review). Recall and the ให้แก้ไข window are mutually exclusive and together cover every `pending_approval` state.                                                                                                                                          |
| D5  | **Recall always lands `in_progress`.** The pre-submit status is not tracked, and `in_progress` is where capture happens. A prior `on_hold` is not restored — the PM re-holds if needed (minor; noted, not solved).                                                                                                                                                                                                                                                                                                                                           |
| D6  | **The predicate is a shared DEFINER function `can_recall_work_package(p_wp)`**, exactly like `photo_removal_allowed`: the RPC calls it to enforce, and `load-detail` calls it to render the button, so RLS and the affordance share ONE authority and cannot drift. It must be DEFINER because the submitter read hits `audit_log`, whose `SELECT` is an EVENT ALLOWLIST for site_admin/procurement (load-detail's own note) — `wp_status_transition` is not on it, so a user-session read cannot see the submitter. The DEFINER function reads it as owner. |
| D7  | **The caller must CURRENTLY hold a `WP_SUBMIT_ROLES` role.** A submitter since demoted to read-only `procurement` cannot recall. super_admin is in the set, so the D3 override is `role in WP_SUBMIT_ROLES AND (auth.uid() = submitter OR role = 'super_admin')`.                                                                                                                                                                                                                                                                                            |
| D8  | **Recall does NOT reopen the approver-alters-evidence hazard** (the 291/340 concern), so no decider-exclusion clause is needed. Recall never edits evidence in place — it returns the WP to `in_progress`, out of every reviewer's queue; the subsequent re-submit forces a fresh review of the final state. A reviewer (even the prior decider) therefore never approves stale evidence. This is why recall is safe where in-place removal on a frozen WP is not.                                                                                           |

## Unit U1 — the recall RPC + predicate (schema, migration `20260813075847`)

Two SQL functions, both `SET search_path = public`:

- **`can_recall_work_package(p_wp uuid) returns boolean`** — `STABLE SECURITY
DEFINER`. Returns true iff ALL hold (fails closed via `coalesce(..., false)`):
  1. `current_user_role()` ∈ `{site_admin, project_manager, super_admin,
project_director, procurement_manager}` (the `WP_SUBMIT_ROLES` mirror, same
     literal array as `submit_work_package_for_approval`).
  2. `can_see_wp(p_wp)`.
  3. `work_packages.status = 'pending_approval'`.
  4. The revision window is **closed** — NOT (latest `approvals` decision for the
     WP = `needs_revision` AND no `audit_log` `wp_evidence_resubmitted` row
     answering that decision id). Same window logic inlined in
     `photo_removal_allowed`; inlined here rather than editing that protected
     function.
  5. `current_user_role() = 'super_admin'` **OR** `auth.uid()` = the submitter =
     `actor_id` of the most-recent `audit_log` row where
     `target_table='work_packages' AND target_id=p_wp AND
payload->>'event'='wp_status_transition' AND
payload->>'to_status'='pending_approval'` (order by `created_at desc, id
desc` limit 1). A null submitter satisfies only the super_admin arm
     (`is distinct from` guards the null).

- **`recall_work_package_submission(p_wp uuid) returns boolean`** — `SECURITY
DEFINER`, plpgsql. `select ... for update` on the WP (serialises against a
  concurrent decide/submit), raise `22023` if not found, raise `42501` if
  `not can_recall_work_package(p_wp)`, then
  `update work_packages set status='in_progress' where id=p_wp and
status='pending_approval'`. The `for update` + re-check make the status read
  the status written. Grants: `revoke all ... from public, anon; grant execute
... to authenticated` (per the RPC-grant gotcha).

**pgTAP `352-recall-submission`** (RED-first): fresh submit by the submitter →
recallable + lands `in_progress`; by super_admin (not submitter) → recallable; by
a DIFFERENT site_admin (not submitter, not super) → refused 42501; open
needs_revision window → refused; re-submitted-after-a-cycle (window closed) →
recallable; a demoted-to-procurement submitter → refused; `complete`/`rework`
status → refused (wrong status); null-submitter (pre-337) → super_admin only.
Assert the transition-audit row lands with the recaller's `actor_id`.

## Unit U2 — the affordance (code)

- **`src/lib/photos/transitions.ts`** — no new pure rule is possible (the gate
  needs DB reads); U2 consumes the U1 predicate via `load-detail`.
- **`load-detail.ts`** — add `canRecall: boolean` to the return, from
  `supabase.rpc('can_recall_work_package', { p_wp })` (RLS-session call; the
  DEFINER function does the privileged reads). Batches with the existing reads.
- **`recallWorkPackageSubmission` action** (WP actions.ts) — mirrors
  `submitWorkPackageForApproval`: `requireActionRole(WP_SUBMIT_ROLES)` → RLS-scoped
  WP read (membership gate) → `rpc('recall_work_package_submission')` →
  `revalidatePath`. Map `42501 → "ถอนงานไม่ได้ (คุณไม่ใช่ผู้ส่งงานนี้ หรือสถานะเปลี่ยนไปแล้ว)"`,
  `22023 → "ไม่พบรายการงาน หรือสถานะเปลี่ยนไปแล้ว"`.
- **`recall-submission-control.tsx`** — a confirm sheet (recall is a status
  change; make it deliberate). Copy explains: งานจะกลับไปสถานะ "กำลังทำ" เพื่อแก้ไขรูป
  แล้วส่งตรวจใหม่. Button label **ถอนงานกลับมาแก้ไข**.
- **`page.tsx`** — render the control when `!readOnly && canRecall`. It appears in
  the `pending_approval` block, the same region where ส่งงานเข้าตรวจ shows for the
  editable states — the two are never shown together (mutually exclusive status).
- **vitest** — action success/refusal mapping; the control's confirm flow;
  page-wiring pin (button present ⇔ `canRecall`, mutation-checked); label pins
  (`ถอนงานกลับมาแก้ไข` present, mutation-checked absence on the retired-string test).

**Failure modes / recovery**

| Mode                                               | User sees                                                    | Recovery                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| Non-submitter, non-super, WP pending_approval      | button hidden; action (if desynced) refuses `ถอนงานไม่ได้ …` | ask the submitter, or the operator (super_admin)              |
| Open ให้แก้ไข window                               | button hidden                                                | remove the wrong photo in place (spec 291) — no recall needed |
| Colleague decided/moved it while the page was open | `22023` → `ไม่พบรายการงาน หรือสถานะเปลี่ยนไปแล้ว`            | reload; the new state dictates the path                       |
| Pre-337 submission (null submitter)                | button shows for super_admin only                            | super_admin recalls; SA asks the operator                     |

## Shipping

U1 + U2 land in **one PR** (the feature's button needs its RPC). The migration
makes it a **danger-path PR held for the operator's admin-merge** (the standing
grant: destructive/migration held). Code-path checks auto-run; pgTAP runs on the
merge ref.

## Out of scope (v1)

Recall while a ให้แก้ไข window is open (use spec-291 in-place removal); notifying
the reviewer that a WP left their queue (the queue is status-derived — it simply
drops out, and reappears on re-submit); restoring the exact pre-submit status
(D5); a bulk "recall + auto-remove all photos" shortcut (the operator removes the
specific wrong ones after recall, as in the normal editable flow).
