# Spec 353 — WP rejection paths + หลังแก้ไข availability

**Status:** operator directive 2026-07-24 — "หลังแก้ไข should only be available
when rework is needed. PM has 2 types of rejections: reject evidence and reject
work." Design approved same day. **Code-only, 4 units, NO schema** (operator
chose the UI + server-action gate over a DB trigger). Refines specs 337 (F3
`rejected`→`rework`), 216 (หลังแก้ไข rework buckets), 247/248 (submit gates),
291 (evidence re-shoot window).

## Problem

The PM's WP review offers three outcomes ([record-decision-form.tsx][form]),
enforced by the live `decide_work_package` RPC:

| Choice        | Enum             | Live RPC effect                                              | Operator's name     |
| ------------- | ---------------- | ------------------------------------------------------------ | ------------------- |
| อนุมัติ       | `approved`       | → `complete`                                                 | approve             |
| ให้แก้ไข      | `needs_revision` | status **unchanged** (stays `pending_approval`)              | **reject evidence** |
| ส่งกลับแก้งาน | `rejected`       | → `rework`, `rework_round++`, audit `via='review_rejection'` | **reject work**     |

Two things are wrong:

1. **The หลังแก้ไข (after_fix) capture affordance leaks onto WPs where no
   rework is happening** — the operator's core complaint. The gate is
   `showAfterFix = wp.status === "rework" || photosByPhase.after_fix.length > 0`
   ([page.tsx:398][gate]), and it drives the **capture** tile
   ([phase-uploader.tsx:129,279][tile]), not just the read-only gallery. The
   second arm never turns off once a WP holds any after_fix photo. And
   `readOnly` is **role**-based (`isReadOnlyWpViewer(ctx.role)`), not status — so
   a site_admin on a `complete` WP still gets the full capture zone, tile
   included.

2. **The two rejection labels drift and the SA-facing one is stale.** The form
   says `rejected` = "ส่งกลับแก้งาน", but the shared `APPROVAL_DECISION_LABEL.rejected`
   = **"ไม่อนุมัติ"** ([labels.ts:782][labels]) — the _old inert_ framing from
   before 337 F3 — and that is what the SA sees on the WP-detail attention card,
   on `/review`, and in notifications. Two label homes that disagree, and the
   SA reads the wrong one.

## What the live data says (queried 2026-07-24, prod)

| Fact                                                                                                                                                                                                                                                                      | Consequence                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `photo_logs` INSERT policy has **no WP-status gate** on a fresh (non-superseding) photo — status only gates the tombstone arm: `role ∈ {sa,pm,super,pd,proc_mgr} AND can_see_wp AND uploaded_by=auth.uid() AND (superseded_by IS NULL OR photo_removal_allowed(...))` | The leaked tile does not merely show — it **writes**. A fresh after_fix insert is admitted at **any** status, including `complete`.                                                                                                                                                                                                                                                                |
| `addPhoto` gates `phase='defect'` on `status='rework'`, but has **no** status gate for `phase='after_fix'` ([actions.ts][actions])                                                                                                                                        | Nothing in the write path stops an after_fix insert on a non-rework WP.                                                                                                                                                                                                                                                                                                                            |
| **21 WPs currently show a working หลังแก้ไข tile with no rework active**: 20 `complete` (148 photos) + 1 `pending_approval` (3 photos)                                                                                                                                    | The operator's bug, live at scale. An SA can add a หลังแก้ไข photo to a completed WP, bypassing the report-defect→rework door entirely.                                                                                                                                                                                                                                                            |
| **0** WPs are in `rework`; **0** WPs have `rework_round > 0`; all 21 leaked WPs are `rework_round = 0`                                                                                                                                                                    | Every current after_fix photo predates F3 (free-capture legacy). The gate `rework_round > 0` turns capture **off** for all 21 with zero cleanup needed — they become read-only history.                                                                                                                                                                                                            |
| `decide_work_package`: `needs_revision` leaves status; `rejected` → `rework` + `rework_round++` (confirmed via `pg_get_functiondef`)                                                                                                                                      | The RPC already matches the operator's two-rejection model — this spec touches **only** the UI/label/gate layer, never the RPC.                                                                                                                                                                                                                                                                    |
| Completion-evidence SSOT `canSubmitForApproval` ([transitions.ts:50][trans]): `rework` → current-round `after_fix`; else → `after`                                                                                                                                        | after_fix is a WP's completion evidence exactly when it is a rework cycle. (`canSubmitForApproval` itself keys on `status`, a submit-time lens that reads `after` at `pending_approval`; the capture gate instead keys on the durable `rework_round > 0`, which stays true for a reworked WP bounced with needs_revision — see D2/D8.) This is the key the capture gate must reuse — not `status`. |
| The `needs_revision` resubmit gate accepts a new `after` **or** `after_fix` photo ([resubmit.ts:122][resubmit])                                                                                                                                                           | On a leaked WP an SA can satisfy the reject-evidence loop with after_fix, so "reject-evidence routes to `after`" is not actually guaranteed.                                                                                                                                                                                                                                                       |

## Root cause

One boolean (`showAfterFix`) conflates two questions: _"offer capture into
after_fix"_ and _"this WP has after_fix history to show."_ They must be split.

The gate that decides capture is **not** `status === 'rework'` — that would
strand the reject-evidence loop for a _reworked_ WP. A WP whose completion
evidence is the after_fix photo (`rework_round > 0`) can itself be bounced with
**needs_revision** (→ stays `pending_approval`), and the SA must re-shoot
after_fix in that state. The precise capture window is:

```
canCaptureAfterFix = rework_round > 0 && (status === 'rework' || isRevisionWindowOpen(…))
```

Read plainly: **after_fix is capturable exactly when photos are mutable AND this
is a rework cycle.** It reuses `isRevisionWindowOpen` ([deletable.ts:43][del]),
the same window that already governs photo deletion, so the two cannot drift.

Checked against every case:

| WP state                                                  | `rework_round` | `canCaptureAfterFix`       | Correct?                       |
| --------------------------------------------------------- | -------------- | -------------------------- | ------------------------------ |
| `rework` (actively curing, any round)                     | ≥1             | **true**                   | ✓ capture                      |
| `pending_approval`, reworked, `needs_revision` unanswered | ≥1             | **true** (revision window) | ✓ re-shoot after_fix           |
| `pending_approval`, reworked, awaiting first review       | ≥1             | false                      | ✓ submitted — wait             |
| `complete`, reworked                                      | ≥1             | false                      | ✓ history only                 |
| Any state, never reworked (incl. all 21 leaked WPs)       | 0              | false                      | ✓ after_fix isn't its evidence |

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Split the gate.** `showAfterFixCapture` (drives the shutter tile) is computed from `canCaptureAfterFix`; `showAfterFixHistory = after_fix.length > 0` (drives the read-only galleries) stays as-is. The one conflated boolean becomes two.                                                                                                                                                                                          |
| D2  | \*\*The capture window is `rework_round > 0 && (status === 'rework'                                                                                                                                                                                                                                                                                                                                                                   |     | isRevisionWindowOpen(…))`**, expressed as a new pure predicate `canCaptureAfterFix`living beside`canDeleteWpPhotos`([deletable.ts][del]) and reusing`isRevisionWindowOpen`. Gating on `status === 'rework'` alone is rejected — it breaks reject-evidence for a reworked WP (Root cause). |
| D3  | **History is preserved, re-homed (doctrine §2).** Hiding the tile removes the SA's only inline view of past after_fix photos in the capture view, so when `after_fix.length > 0` but capture is off, the tile renders as a **read-only history strip** — same photos, same `#N` numbers, no shutter, no "ถ่ายเมื่อแก้ไขงานเสร็จ" prompt. Nothing is lost; the 21 legacy WPs need no data change.                                      |
| D4  | **Server-action gate mirrors the UI.** `addPhoto` refuses a `phase='after_fix'` insert unless `canCaptureAfterFix` holds — the same shape as the existing `defect`→`rework` guard. The predicate is shared so the UI's tile visibility and the action's refusal cannot drift. (No DB trigger this spec — operator picked UI + action; the deeper "INSERT RLS has no status gate for any phase" hole is recorded as a non-goal below.) |
| D5  | **Sharpen the two rejection labels on the evidence-vs-work axis** (operator pick 2026-07-24). Proposed Thai (operator may tweak): `needs_revision` label **"ถ่ายรูปใหม่"**, hint **"รูปหลักฐานไม่ครบหรือไม่ชัด — ถ่ายใหม่แล้วส่งตรวจอีกครั้ง (งานไม่ต้องแก้)"**; `rejected` label **"ส่งกลับแก้งาน"**, hint **"ตัวงานต้องแก้ไข — งานจะกลับเป็นงานแก้ไข (รอบใหม่) แล้วถ่ายรูปหลังแก้ไข"**; `approved` label **"อนุมัติ"** unchanged.   |
| D6  | **Unify the label homes into one SSOT and fix the drift.** The form's local `DECISION_LABEL`/`DECISION_HINT` and `labels.ts` `APPROVAL_DECISION_LABEL` collapse to one source, so the PM form, the SA attention card, `/review`, and notifications read identically. This corrects the stale `rejected = "ไม่อนุมัติ"` the SA sees today.                                                                                             |
| D7  | **The needs_revision CTA names the evidence phase.** The generic "ถ่ายรูปเพิ่ม" attention-card link ([page.tsx:926][cta]) becomes phase-specific — "ถ่ายรูปหลังทำงานใหม่" for a round-0 WP, "ถ่ายรูปหลังแก้ไขใหม่" for a reworked WP — so reject-evidence points the SA at the right phase.                                                                                                                                           |
| D8  | **Align the resubmit gate to the current evidence phase.** `resubmitState` keys on a new photo in the evidence phase (`rework_round > 0 ? after_fix : after`) instead of `after`-OR-`after_fix`, making reject-evidence unambiguous. Belt-and-suspenders once D2 gates capture, but it makes the rule explicit and testable rather than relying on the tile being hidden.                                                             |

## Units

### U1 — split the after_fix gate (capture vs history)

- New pure predicate `canCaptureAfterFix({ status, reworkRound, latestDecision, revisionAnswered })` in `src/lib/photos/deletable.ts` (or a sibling), reusing `isRevisionWindowOpen`.
- `page.tsx`: compute `showAfterFixCapture` from it (passing the WP's `rework_round` + latest decision + answered flag it already has in scope); keep `showAfterFixHistory = photosByPhase.after_fix.length > 0` for the existing PhaseGallery rounds.
- `phase-uploader.tsx`: the หลังแก้ไข tile takes both flags — renders the **shutter** button when `showAfterFixCapture`, else a **read-only history strip** (photos + `#N`, no camera, no capture prompt) when `showAfterFixHistory`, else nothing.
- **Test:** the tile is a shutter for `rework`/reworked-`needs_revision`; read-only for `complete`/round-0-with-history; absent for a never-reworked WP with no after_fix photos. Mutation-check the round-0 arm (the 21-WP case).

### U2 — server-action gate on after_fix insert

- `addPhoto` ([actions.ts][actions]): after the WP lookup, if `phase === 'after_fix'` and `!canCaptureAfterFix(...)`, refuse with a Thai message — mirroring the existing `defect` block. Needs the WP's latest decision; add the one read the page already does (latest `approvals` row + a `wp_evidence_resubmitted` existence check) so the action evaluates the identical predicate.
- **Test:** an after_fix insert on a `complete` / round-0 `pending_approval` WP is refused; on a `rework` WP and a reworked-`needs_revision` WP it is admitted. Mutation-check both directions.

### U3 — rejection framing + label SSOT

- Collapse `DECISION_LABEL`/`DECISION_HINT` ([form][form]) and `APPROVAL_DECISION_LABEL` ([labels.ts][labels]) to one SSOT with the D5 wording.
- Re-point the PM form, the attention-card title ([page.tsx:915][gate]), `/review`, and `compose-notification` at the SSOT; verify the notification sentence still reads sensibly with the new labels.
- D7: phase-specific needs_revision CTA.
- **Test:** RTL over the rendered PM form (both new labels present, old "ไม่อนุมัติ"/"ให้แก้ไข" **absent** — pinned bare, mutation-checked) + the attention card renders the same string the form shows for the same decision. Guard the single-SSOT invariant (no second literal home).

### U4 — resubmit evidence-phase alignment

- `resubmitState` ([resubmit.ts][resubmit]): replace the `after`-OR-`after_fix` newer-than-decision check with the current evidence phase (`rework_round > 0 ? after_fix : after`). `ResubmitStateArgs` gains `reworkRound`.
- **Test:** a round-0 `needs_revision` WP is `ready` only after a new `after` photo (a new after_fix does not satisfy it); a reworked `needs_revision` WP is `ready` only after a new `after_fix`. Mutation-check both.

## Testing (cross-unit)

- Full `pnpm lint && pnpm typecheck && pnpm test` green.
- Real-flow verify per unit gate 4 (dev-preview login): a `complete` WP that
  carries after_fix photos shows the read-only strip and **no** shutter; a
  hand-driven `rework` WP shows the shutter. (Browser drive on these WP-detail
  surfaces has historically been wedged in the in-app browser — RSC-flight /
  RTL / live-DB probes are the documented substitute.)
- No migration; `pnpm db:test` run once to confirm no queue-ejector regression
  (doctrine — code-only units still run it).

## Non-goals / open

- **The INSERT RLS has no status gate for _any_ fresh photo.** `before`/`during`/
  `after` are also technically insertable on a `complete` WP (the `after`
  auto-flip was removed by FB2, so nothing bounces them). This is a broader
  latent hole than the operator's ask; recorded here as a **separate
  observation**, not folded into this spec. A DB-level `photo_logs` INSERT guard
  keyed on WP status would close the whole class — a candidate follow-up
  (danger-path migration, operator-gated).
- **No cleanup of the 151 legacy after_fix rows.** Append-only; they become
  read-only history under D3. Recoding/removing them is not part of this unit.
- **`decide_work_package` is untouched.** The RPC already implements the two
  rejection paths correctly; this spec is the UI/label/gate layer only.
- **The reworked-WP `needs_revision` path stays `pending_approval`** (not kicked
  back to `rework`). D2's revision-window arm handles it in the capture layer;
  changing the RPC's status behaviour would be a danger-path change and is out
  of scope.

[form]: ../../src/app/review/work-packages/%5BworkPackageId%5D/record-decision-form.tsx
[gate]: ../../src/app/projects/%5BprojectId%5D/work-packages/%5BworkPackageId%5D/page.tsx
[cta]: ../../src/app/projects/%5BprojectId%5D/work-packages/%5BworkPackageId%5D/page.tsx
[tile]: ../../src/app/projects/%5BprojectId%5D/work-packages/%5BworkPackageId%5D/phase-uploader.tsx
[actions]: ../../src/app/projects/%5BprojectId%5D/work-packages/%5BworkPackageId%5D/actions.ts
[labels]: ../../src/lib/i18n/labels.ts
[trans]: ../../src/lib/photos/transitions.ts
[resubmit]: ../../src/lib/approvals/resubmit.ts
[del]: ../../src/lib/photos/deletable.ts
