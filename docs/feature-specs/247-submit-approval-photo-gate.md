# Spec 247 — Photo gate on "ส่งงานเข้าตรวจ" (submit WP for approval)

**Status:** approved (operator, 2026-07-03)
**Origin:** operator directive — "Instead of changing status automatically, allow SA to submit WP for approval after 'complete' images are uploaded." The first half (no auto status change + explicit submit) shipped as FB2 `b9e942f0` (#149). This spec adds the missing half: the submit is only allowed once completion evidence exists.

## Problem

`submitWorkPackageForApproval` (and its "ส่งงานเข้าตรวจ" button on the WP detail page) currently allows submitting a WP for approval from any TRANSITIONABLE status with **zero photos**. A WP can reach the PM's review queue with no completion evidence.

## Rule (single unit, code-only)

A WP may be submitted for approval only when it carries current completion-photo evidence:

| WP status                               | Required evidence                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `not_started`, `in_progress`, `on_hold` | ≥1 current `after` photo                                                                                        |
| `rework`                                | ≥1 current `after_fix` photo whose `rework_round` = the WP's `rework_round` (this round's fix, not a stale one) |

"Current" photo = the supersede current-state read: anti-join (no newer row's `superseded_by` points at it) **and** tombstone filter (`storage_path is not null`) — ADR 0009 / ADR 0015. A deleted (tombstoned) photo does not count.

## Enforcement — two layers, no schema

1. **Pure predicate** — `requiredPhaseForSubmit(status)` + a submit-eligibility helper in `src/lib/photos/transitions.ts` (the existing home of WP photo-transition logic). Unit-tested.
2. **UI** — the WP detail page already loads `photosByPhase` (current-state); it computes eligibility and passes it to `SubmitForApprovalControl`. Ineligible → the button renders **disabled with an inline hint**: first pass "ถ่ายรูปหลังทำงานก่อนจึงจะส่งตรวจได้", rework "ถ่ายรูปหลังแก้ไขก่อนจึงจะส่งตรวจได้". Visible-but-disabled (not hidden) keeps the SA's next step discoverable (Field-First). Strings used once → inline, not labels.ts.
3. **Server action** — `submitWorkPackageForApproval` re-checks before the status UPDATE with its own RLS-scoped `photo_logs` query (anti-join + tombstone filter + phase + rework-round match where applicable). Failure returns the same Thai hint as the UI. The UI gate is convenience; the action gate is the enforcement.

## Out of scope

- The During → `in_progress` auto-flip (kept, operator decision in FB2).
- PM approval/decision flow.
- Any schema change, RPC, or migration.
- Minimum photo COUNTS or per-phase completeness (before/during) — one `after`/`after_fix` photo is the evidence bar for v1.

## Verification checklist

- [ ] Predicate unit tests: each status maps to the right phase; rework requires the current round; tombstoned/superseded photos don't count (3-row chain test per supersede-pattern skill).
- [ ] Action test: submit with no qualifying photo refused with the hint; with a qualifying photo proceeds.
- [ ] Control test: disabled + hint when ineligible; active when eligible.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] Real-browser check on the WP detail at phone width (dev-preview login).
