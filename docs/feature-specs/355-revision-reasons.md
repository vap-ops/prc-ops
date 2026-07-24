# Spec 355 — structured reject-evidence reasons (why the PM sends photos back)

**Status:** operator directive 2026-07-24 (follow-on from spec 353). The wrong-WP
upload problem — an SA photographing the wrong work package — surfaces at review as
**PM rejections caused by image mismatch**. Grounded in the 37 live `needs_revision`
comments (queried 2026-07-24): the reasons fall into three families, and the
`reject-evidence` action gives all of them the same instruction ("ถ่ายรูปใหม่")
even though the SA's correct next step differs per cause. Design approved 2026-07-24.

## Problem

Spec 353 gave the PM two rejection **types** — reject-evidence (`needs_revision`,
"ถ่ายรูปใหม่", stays in queue) and reject-work (`rejected` → rework). But
reject-evidence has three distinct **causes**, each needing a different SA action,
and today the PM types them as free text and the SA gets a generic "re-shoot":

| Cause (live comment signature)                                       | Example live comments                                                                                      | The SA's correct action                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **incomplete** — photos missing                                      | "เพิ่มรูปเตรียมงาน", "ใส่ภาพก่อน ระหว่าง หลัง", "ทางเชื่อมมี 2 ฝั่ง ลงรูปให้ครบ"                           | ADD the missing phase's photos                 |
| **mismatch** — wrong photos (the wrong-WP problem, caught at review) | "รูปไม่ตรงกับงาน", "พื้นที่ในรูปไม่ตรงกับงาน", "ลงรูปไม่ตรงกับงาน สีจริงคือสีขาว", "เปลี่ยนรูปใหม่ทั้งหมด" | REMOVE the wrong photos + shoot the RIGHT ones |
| **premature** — submitted too early                                  | "งานยังไม่จบ ต้องรอให้หล่อครบ", "ติดตั้งให้แล้วเสร็จแล้วค่อยกดส่ง"                                         | FINISH the work, then shoot completion         |

"ถ่ายรูปใหม่" (re-shoot) fits **incomplete**, is _misleading_ for **mismatch** (the SA
should remove-and-replace, not add) and **premature** (nothing to re-shoot yet). And
because the cause is unstructured free text, we cannot measure how often mismatch —
the wrong-WP pain — actually drives rejections, so we cannot tell whether any
prevention work moves the needle.

## What the live data says (queried 2026-07-24, prod)

| Fact                                                                                                                                                                                                                                                                                                        | Consequence                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 37 `needs_revision` decisions (34 distinct comments). The exact "ไม่ตรงกับงาน" string is 3–4 of them (~10%); the broader **wrong-photo family** — "รูปไม่ตรงกับงาน", "รูปไม่สอดคล้องกับลำดับงาน", "เปลี่ยนรูปใหม่ทั้งหมด", "ใช้แค่รูปที่เกี่ยวข้องกับงาน", "ลบรูปที่ใช้อุปกรณ์อื่น…" — is **~9 of 34 (~¼)** | Mismatch is a real, recurring rejection cause — not a rare edge. It deserves a first-class reason + its own SA instruction.         |
| 80 photo removals across 27 WPs, all in the last ~30 days (the 291/341 delete tooling)                                                                                                                                                                                                                      | The wrong-WP remediation is heavily used; every existing tool is _undo_, none is a reason-aware fix loop at the point of rejection. |
| `decide_work_package(p_wp, p_decision, p_comment)` requires a comment for any non-approved decision (`22023` when null); `approvals` holds `(work_package_id, decision, comment, decided_by, decided_at)`                                                                                                   | The reason attaches cleanly as one more column + one more RPC param; the comment demotes to optional _detail_ on needs_revision.    |
| Neither existing reason enum — `purchase_request_reason_code` (purchases) nor `confiscation_reason` (fraud/theft/…) — fits WP-approval                                                                                                                                                                      | WP-approval revision reasons need a NEW enum — not a reuse.                                                                         |

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **A structured reason is REQUIRED on reject-evidence.** When the PM picks ให้แก้ไข (`needs_revision`) they must pick one of three reasons. Free-text comment stays but becomes OPTIONAL _detail_ (which phase, what's wrong).                                                                                                                          |
| D2  | **Three reasons, new enum `approval_revision_reason` = `incomplete` · `mismatch` · `premature`.** Thai labels (operator may tweak): incomplete → "รูปไม่ครบ", mismatch → "รูปไม่ตรงกับงาน", premature → "งานยังไม่เสร็จ". Codes are English snake_case per house convention (approval_decision, reason_code).                                          |
| D3  | **The reason drives a TAILORED SA next-action** on the spec-353 attention card — never the generic "ถ่ายรูปเพิ่ม": incomplete → "เพิ่มรูป <phase>"; **mismatch → "ลบรูปที่ไม่ตรง แล้วถ่ายใหม่ให้ตรงกับงาน" with the spec-291 delete affordance surfaced so removing the wrong shots is one tap**; premature → "ทำงานให้เสร็จก่อน แล้วถ่ายรูปตอนเสร็จ". |
| D4  | **The reason lives on `approvals.revision_reason` (nullable enum)** and `decide_work_package` gains `p_revision_reason`, validated: NON-NULL iff `p_decision='needs_revision'`, NULL for approved/rejected. reject-work (`rejected`) keeps its comment-required defect description (spec 217 source) — untouched.                                      |
| D5  | **The reason is measurable.** A single query (`revision_reason`, count) answers "what % of reject-evidence is mismatch?" — the yardstick for any later wrong-WP prevention (the P1/P2 capture-identity ideas parked from this brainstorm). No console in v1; the column is the deliverable.                                                            |
| D6  | **No auto-remove of the mismatched photos.** The PM flags mismatch; the SA (the uploader) removes them via the existing spec-291 window (uploader-only, audited). The system points, the human acts — consistent with the 291/340 custody rules. Routing mismatched photos to their CORRECT WP (a move) is explicitly out of scope (see Non-goals).    |

## Units

### U1 — schema (enum + column + RPC) · additive migration, operator-merged

- New enum `public.approval_revision_reason` (`incomplete`, `mismatch`, `premature`).
- `alter table approvals add column revision_reason approval_revision_reason` (nullable; historical rows stay null).
- `decide_work_package` DROP+CREATE from the LIVE body + trailing `p_revision_reason approval_revision_reason default null`. New validation, replacing the blanket comment-required rule:
  - `needs_revision`: `p_revision_reason` required (else `22023`); comment now OPTIONAL.
  - `rejected`: comment required (unchanged); `p_revision_reason` must be null (else `22023`).
  - `approved`: both null.
  - Insert `revision_reason` alongside the existing columns.
  - **Preserve the live `rejected` branch verbatim** — it writes an `audit_log` `wp_reopened_for_defect` row using the comment as its `reason` (spec 337 F3). Keeping comment-required for `rejected` keeps that reason populated; the DROP+CREATE must carry it forward unchanged.
- **Test (pgTAP):** the three validation arms + that a needs_revision row persists its reason + that a rejected row still requires a comment and rejects a stray reason. RED-first.

### U2 — PM form: reason chips · code-only

- `record-decision-form.tsx`: when `needs_revision` is selected, render the three reason chips (radio/segmented); `canSubmit` requires a reason for needs_revision (comment optional); the `recordDecision` action + `decide_work_package` call thread `revisionReason`.
- New SSOT `APPROVAL_REVISION_REASON_LABEL` in `labels.ts` (Thai labels, D2). **Register it in the hardcoded `MAPS` array in `tests/unit/i18n-labels.test.ts`** — the enum-completeness harness does NOT auto-discover new enums, so this is a manual add (the three labels are distinct + Thai, so they pass once registered).
- `recordDecision` server action (`review/.../actions.ts`) gains `revisionReason`; the client-side predicate (`predicates.ts`) mirrors the required-when-needs_revision rule.
- **Test:** RTL — the chips appear only for needs_revision, submit disabled until one is picked, comment optional; the action threads the reason; label SSOT pinned.

### U3 — SA side: tailored next-action · code-only

- `load-detail`/`page.tsx`: read the latest decision's `revision_reason`; the spec-353 attention card renders the reason label + a per-reason CTA/guidance (D3). For **mismatch**, the card explicitly says to remove the wrong photos and re-shoot, and links to the capture zone where the spec-291 delete is available (the window is already open on a needs_revision WP).
- The SA action-list chip (`action-section.tsx`) may show the reason too (single-sourced from the label), so the ต้องแก้ไข worklist tells the SA _why_ at a glance.
- **Test:** RTL — each reason renders its specific CTA text (not the generic one); mismatch surfaces the remove-and-reshoot guidance; mutation-checked.

## Testing (cross-unit)

- Full `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:test` green (U1).
- Real-flow: dev-preview as a PM, reject-evidence a WP with each reason → the row carries the reason; as the SA, the attention card shows the tailored action (browser drive on WP-detail is the documented in-app wedge → RTL + live-DB probe substitute).
- Migration is additive (new enum + nullable column + RPC replace) — no backfill; historical `needs_revision` rows keep a null reason and render the generic guidance (unchanged for them).

## Non-goals / open

- **No photo MOVE across WPs.** When the mismatched photos actually belong to another
  WP, the ideal is to route them there — but that is a bigger build (cross-WP move
  under photo_logs append-only + the freeze rules) and is deferred. v1 = remove +
  re-shoot on the correct WP.
- **No capture-time prevention here.** The parked P1/P2 (unmistakable capture identity;
  post-capture review) attack the mismatch at the source; this spec makes the rejection
  reason-aware and measurable first, so prevention can be justified by the data D5
  exposes.
- **reject-work is untouched.** Its reason is the defect description + source (spec 217).
- Whether `premature` should instead be its own pre-submit signal (rather than a
  needs_revision reason) is left as a future refinement — v1 keeps it a reason (operator
  decision 2026-07-24: keep all three).
