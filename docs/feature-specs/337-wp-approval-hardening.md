# Spec 337 — WP approval hardening

**Status:** approved design (operator decisions locked in-session 2026-07-22). Build order U1 → U2 → {U3, U4, U5}.
**Source:** WP lifecycle-gates audit 2026-07-22 (baseline-first method; findings verified against live DB + `700766b5`, re-verify against HEAD at build — `15013574` at spec time).
**Owner surfaces:** WP detail (`/projects/:pid/work-packages/:wpid`), review queue (`/review`, `/review/work-packages/:wpid`).

## 0. Context — what the audit established

The WP approval flow is BUILT and ALIVE: SA (SITE_STAFF_ROLES) submits via ส่งงานเข้าตรวจ behind a photo-evidence gate (spec 247/248) → `pending_approval` → PM_ROLES record `approved` / `needs_revision` / `rejected` on `/review` (comment required on negatives; `approvals` INSERT RLS is load-bearing) → `approved` flips `complete` + `freeze_wp_labor_cost` (spec 68). needs_revision bounce loops close in practice (13 WPs with 2-3 decisions).

Four verified defects this spec fixes:

- **F1 — 100% anonymous transitions.** All three status write paths (submit, approve-flip, During-photo auto-flip) run on the ADMIN client, so `wp_transition_audit` records `actor_id NULL` in 361/361 rows (count at spec time; re-verify at build — the invariant is the 100%, not the number). WHO submitted is recorded nowhere. Root cause note: `authenticated` has NO table-level UPDATE grant on `work_packages` at all (revoked at ERD-audit M2) — the in-code comments blaming "RLS does not admit site_admin" are outdated, and the RLS UPDATE policy (PM/PD/super) is unreachable dead code. Blocks ADR 0060's anti-favoritism requirement (attributed, tamper-evident facts).
- **F2 — the cure loop has no signal.** After a needs_revision, SA re-shoots but nothing tells the decider, the queue item looks unchanged (40-deep queue, oldest ~1wk), and the approver cannot tell new photos from old.
- **F3 — `rejected` is inert.** 0 uses ever; records a comment, changes nothing; semantics undefined. There is no work-rejection path pre-complete.
- **F6 — defect reopen is undiscoverable.** `ReportDefectControl` (spec 144/248) is complete and well-gated but renders only on the WP detail of a `complete` WP — a page no worklist ever routes back to. 0 uses ever.

Operator decisions (final, do not re-litigate):

1. Two rejection types stay: `needs_revision` = evidence-cure (photos only, WP stays `pending_approval`); `rejected` = work send-back.
2. `rejected` flips the WP to the EXISTING `rework` status + `rework_round++` — reusing the spec 144/216/217/218 machinery whole (after_fix phase, defect-photo pairing, current-round submit gate, status colors/icons/labels). NO new enum value.
3. Time in `rework` arms the 325 §3 signal: PRs raised for the WP while it is in rework get `reason_code=rework` PRE-PROPOSED at PR approval (approver can override).
4. Cure loop closes by EXPLICIT resubmit (ส่งตรวจอีกครั้ง), not by upload (FB2 precedent: auto-flip on photo was removed for sending partly-done work to review; the PM comment is free text so only SA knows when the ask is answered).
5. F6 gets discoverability entry doors now (operator call, against the field-probe-first recommendation — recorded).

## Non-goals

Warranty/close clock (ADR 0060 settlement — future) · a `wp_status_events` table or tri-state signal registry (audit trigger + `approvals` rows suffice once U1 attributes them) · on_hold changes · grant-hygiene sweep (F8, separate) · blocking approval on open money (U4 is display-only) · the deep 325 §3 cause flow (stays spec 325; U3 only delivers the arming signal + minimal pre-proposal).

---

## U1 — attributed transitions via DEFINER RPCs (schema; claims migration `075826`+)

Move the three WP status transitions off the admin client onto SECURITY DEFINER RPCs running under the USER session, so `auth.uid()` / `current_user_role()` reach the audit trigger. Pattern sources: `reopen_work_package_for_defect` (gate + audit shape), `set_work_package_hold` (ERD-audit M2 precedent — this unit completes that migration direction).

New RPCs (all: `revoke all … from public, anon` — house grant pattern; grant execute to `authenticated`):

1. `submit_work_package_for_approval(p_wp uuid)` — gates: role ∈ SITE_STAFF_ROLES = `site_admin, project_manager, project_director, super_admin` (fact-checked from `role-home.ts:83-88`; mirror, don't invent) + `can_see_wp(p_wp)` + status ∈ `not_started/in_progress/on_hold/rework` (= `TRANSITIONABLE_FROM_STATUSES`). Flips → `pending_approval`. The PHOTO gate stays in the server action (`submitGateReason` needs the current-photos anti-join read; documented split: RPC = status/role invariant + attribution, action = evidence gate). Action swaps its admin-client UPDATE for this RPC.
2. `decide_work_package(p_wp uuid, p_decision approval_decision, p_comment text)` — gates: role ∈ PM_ROLES + `can_see_wp` + status = `pending_approval` + comment required for non-approved. Atomically: INSERT `approvals` row (decided_by = auth.uid()) + status flip per decision: `approved` → `complete`; `rejected` → `rework` AND `rework_round = rework_round + 1`; `needs_revision` → no flip. `recordDecision` swaps its `approvals` insert + admin UPDATE for this RPC; the non-fatal `freeze_wp_labor_cost` follow-up call stays action-side on the PM session (unchanged, spec 68).
3. `resubmit_work_package_evidence(p_wp uuid)` — gates: same submitter set + `can_see_wp` + status = `pending_approval` + latest decision = `needs_revision` + at least one CURRENT after/after_fix photo with `created_at` > that decision's `decided_at`. No status change. Writes an `audit_log` row (`event: 'wp_evidence_resubmitted'`, the decision id it answers) + INSERTs `notification_outbox` (`event_type 'wp_evidence_resubmitted'`, payload: wp id/code/name, project_id, `decided_by` of the answered decision).

⚠️ **`notification_event_type` is a Postgres ENUM (11 values today, fact-checked)** — U1's migration must also `ALTER TYPE notification_event_type ADD VALUE 'wp_evidence_resubmitted'`, update the enum-lockstep pgTAP pin (house enum-guard convention — the pin REDs on the add by design; update deliberately), regen `db:types`, and extend the TS consumers that exhaust the union: `notification-catalog.ts` (`satisfies Record<NotificationEventType,…>`) + the `resolve-recipients.ts` switch + payload + drain route. The notification leg of U2 is therefore NOT code-only — its DB half rides U1's migration; U2 consumes it.

During-photo auto-flip (`not_started → in_progress` in `addPhoto`) keeps its admin-client write THIS unit (scope discipline; it is an auto-transition with no human decision to attribute — the photo row itself is attributed). Recorded as an open question if full attribution is later wanted.

**Negative cases / Thai strings / recovery:**

| Mode                                | Where                 | String (existing unless marked NEW)                                                                                                             | Recovery                            |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Caller role not permitted (42501)   | submit / resubmit     | action-gate message (unchanged) · decide: `เฉพาะผู้จัดการโครงการเท่านั้นที่บันทึกผลการตรวจได้`                                                  | none — wrong role                   |
| Not a project member (42501)        | all 3                 | `ไม่พบรายการงาน` (RLS-shaped refusal, unchanged)                                                                                                | check project membership            |
| Wrong status (22023)                | submit                | `งานนี้ส่งตรวจแล้ว หรือยังไม่พร้อมส่ง`                                                                                                          | refresh; state already moved        |
| Wrong status (22023)                | decide / resubmit     | `รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ`                                                                                                           | refresh — a colleague decided first |
| Comment missing on negative (22023) | decide                | `ผลการตรวจนี้ต้องใส่ความเห็น`                                                                                                                   | fill comment, resubmit              |
| Photo evidence missing              | submit (action layer) | `ถ่ายรูปหลังทำงานก่อนจึงจะส่งตรวจได้` / rework: `ถ่ายรูปหลังแก้ไขก่อนจึงจะส่งตรวจได้` + pairing `ถ่ายรูปแก้ไขให้ครบทุกจุดที่แจ้ง (เหลือ N จุด)` | shoot the missing photos            |
| No new photo since decision (22023) | resubmit              | NEW `ถ่ายรูปเพิ่มก่อนจึงจะส่งตรวจอีกครั้งได้`                                                                                                   | upload then press again             |
| RPC transport failure               | all                   | `ส่งงานเข้าตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` / `บันทึกผลการตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` (unchanged)                                    | retry                               |

**RED-first (pgTAP `337-approval-rpcs`):** role matrix per RPC (`throws_ok` 42501, incl. procurement refused on submit) · wrong-status throws · comment rule · `rejected` → status `rework` AND round increments · `needs_revision` → no flip · `approved` → `complete` · **audit row `actor_id IS NOT NULL` after each RPC (the F1 pin)** · resubmit refuses without a post-decision photo, passes with one, outbox row lands · anon + PUBLIC execute revoked (229-lockdown pattern). Vitest: actions call RPCs (no `.update(` on work_packages remains in these two actions — absence pinned bare + mutation-checked).

**Success probe (fill rate):** every `wp_status_transition` audit row created after deploy has `actor_id NOT NULL`; alert if any NULL appears.

## U2 — cure loop UI: explicit resubmit + decider ping + approver highlight (code, after U1)

SA side (WP detail):

- Action-list item / notification deep-links to the WP detail photo section (decision banner with the PM comment already renders there — the comment IS the shot list).
- New control ส่งตรวจอีกครั้ง renders when status = `pending_approval` AND latest decision = `needs_revision`, same slot pattern as `SubmitForApprovalControl`. Disabled until ≥1 current after/after_fix photo `created_at` > latest `decided_at`; disabled hint = `ถ่ายรูปเพิ่มก่อนจึงจะส่งตรวจอีกครั้งได้`. Press → `resubmit_work_package_evidence` → SA action-list item clears (clear condition = a resubmit audit/outbox row newer than the latest needs_revision decision).
- Notification fan-out: `wp_evidence_resubmitted` targets the DECIDER (`decided_by` from the answered decision) — person, not pool; fallback to the approval pool when the decider is inactive/unresolvable (catalog + `resolve-recipients.ts` + payload + drain route additions).

Approver side (`/review` + review detail):

- Queue splits needs_revision items: `รอถ่ายเพิ่ม` (no resubmit yet) vs `พร้อมตรวจอีกครั้ง` (resubmitted — sorts up, shows `รูปใหม่ N`). Oldest-first ordering ALREADY exists (`updated_at` asc, spec 15 — fact-checked); F5 here = add a visible days-pending age on rows + the split ordering above, NOT a new sort.
- Review detail: pinned strip `รูปใหม่หลังให้แก้ไข (N)` beside the decision history rendering just the new photos (boundary = latest needs_revision `decided_at`; resets each bounce round automatically) + a `ใหม่` chip on those tiles inside the normal phase galleries.

**Negative cases:** stale race (WP decided while SA composes) → resubmit returns wrong-status string, UI refreshes · offline → press disabled (reuse the online gate pattern from `ReportDefectControl`) · decider deactivated → pool fallback (assert in vitest) · zero new photos after boundary → strip hidden entirely, no empty shell (§0 dead-door rule). Recovery per U1 table.

**RED-first:** RTL — control renders only in the exact state pair; disabled/enabled across the boundary; strip/chip appear only for post-boundary photos; queue split + ordering. Mutation-checks per doctrine (constants asserted at ≥2 occurrences; retired literals pinned bare).

## U3 — 325 rework-window consumer (code; coordinate with spec 325 §3)

When a PR is bound to a WP whose status is `rework` (or whose `rework_round` advanced since the PR's creation — window = status-based, primary), the PR approval surface PRE-PROPOSES `reason_code = 'rework'` (existing enum value, spec 325). Approver one-tap confirms or overrides — proposal only, never silent write. WP-less PRs: no proposal. This delivers the "anticipation layer" signal 325 §3 was missing; the fuller cause flow stays in spec 325.

⚠️ **Gate-check 2026-07-22 — read before building this. Three live facts change the unit:**

1. **The WP link is `requested_from_work_package_id`, NOT `work_package_id`.** Store-first procurement (ADR 0065 / spec 208 U4a) makes the server force `work_package_id` to null on every raise — a PR lands in the project store and is เบิก'd to a WP later. Live: 4 of 553 rows carry `work_package_id` (all legacy), 124 of 553 carry the provenance column. A window predicate on the named column fires on nothing, forever.
2. **The window's domain is empty and always has been.** 0 of 396 WPs have ever been `status='rework'`, 0 have `rework_round > 0`, and `approvals` holds 107 approved + 35 needs_revision + **0 rejected**. U1's F3 is the first door into `rework` and had not been used at time of writing. Until rework rows exist, this unit cannot be live-verified and its own success metric cannot be computed.
3. **The channel is already at 100% fill.** `reasonCode` is required at raise (`validate-purchase-request.ts`, spec 176 U4) and **124/124** WP-provenance PRs carry one. The reason gap is entirely PRs with no WP context, which this signal cannot reach. So U3 hardens reliability, it does not close a capture hole.

**Boundary:** the PR-approval surface (a reason control at approval, override, persistence) belongs to spec 325 §3's approver-confirm flow, which covers all five reason codes plus the repeat-purchase signal. 337 owns the WP-lifecycle side — the window predicate — and should hand 325 the arming signal rather than build a second approval UI. **Recommended sequencing: after U5, and only once `wp_reopened_for_defect` events or `rejected` decisions are non-zero.**

**Negative cases:** proposal on a WP that left rework before PR approval → still proposed, approver judges (disclose `งานนี้เคยถูกส่งกลับแก้งาน`) · no reason_code selected → existing 325 behavior unchanged. RED-first: proposal renders exactly when window predicate true; override persists approver's choice.

## U4 — review-page money card (code, display-only)

On `/review/work-packages/:wpid`: a card listing open money against the WP — open PRs (non-terminal statuses) with count + total, pending เบิก, undrained GL outbox rows for WP-scoped sources. ⚠️ **Same column trap as U3 (gate-checked 2026-07-22): "open PRs on the WP" must join `requested_from_work_package_id`, not `work_package_id`** — the latter is force-nulled by store-first procurement, so a card built on it renders `ไม่มีรายการเงินค้าง` on every WP forever. `stock_issues` (the เบิก side) does carry `work_package_id` (14/14 filled). Zero state `ไม่มีรายการเงินค้าง` (calm, §0). Photo-days-vs-labor-days variance already exists on the page — this card sits beside it. Approval is NOT blocked (display-first per audit; a blocking gate is a future operator call).

**Negative cases:** money read gates — `src/lib/accounting/money-read-policy.ts` (exact path, fact-checked); the review WP-detail page is ALREADY a registered PROJECT_SCOPED money-read site, so new reads likely extend the existing registration rather than add one (gate-check at build; audience = the page's existing PM_ROLES, no new role set) · partial load failure → card shows per-section `โหลดไม่สำเร็จ` not a crash. RED-first: card sections render per fixture; zero state; role gate probe (content-absence, not HTTP status).

## U5 — defect-reopen discoverability (code)

Entry doors from surfaces users actually occupy (WP detail stays the home; the control itself is unchanged):

- Project WP list: `complete` WP rows gain a `แจ้งงานมีปัญหา` action (reuse the control's existing label wording at build) that deep-links `/projects/:pid/work-packages/:wpid?defect=1`.
- WP detail: `?defect=1` auto-opens the existing `ReportDefectControl` sheet when (and only when) status = `complete` and the viewer passes the existing gates; otherwise the param is ignored silently (no error — the page renders normally).

**Negative cases:** param on non-complete WP → ignored (assert no sheet) · offline filing → existing online-only block unchanged · role gates unchanged (RPC refuses; SA text-only, planners attach photos — spec 248 split intact). RED-first: RTL param-open matrix; row action renders only on complete rows.

**Success probe:** `wp_reopened_for_defect` audit events > 0 within ~30 days of U5, or the operator field-confirms no defects have occurred — either resolves F6; zero events + defects-did-happen ⇒ revisit placement.

## Success metrics (fill-rate probes, run ~2 weeks post-each-unit)

1. U1: 100% of new transition audit rows attributed (`actor_id NOT NULL`).
2. U2: resubmit events > 0; needs_revision items resolve (approved or re-bounced) faster than the pre-U2 baseline (median days from needs_revision decision to next decision); never-reviewed queue median age drops.
3. U3: share of rework-window PRs approved WITH `reason_code=rework` (target: proposal accepted more often than overridden).
4. U5: see above.

## Open questions

- During-photo auto-flip attribution (left admin-client in U1 — deliberate scope cut).
- Blocking approve on open money (U4 display-first; operator call later).
- Recode/relabel of `rejected` radio wording: build uses `ส่งกลับแก้งาน` label + hint `งานต้องแก้ไข — ต้องใส่ความเห็น` in `record-decision-form.tsx`; goes to `labels.ts` only if a second surface appears.
- 336's two open operator calls (parent-locality of codes; legacy recode) are unrelated but share the WP surface — coordinate if built concurrently.
