# ADR 0075 — Plan-vs-actual variance, append-only baselines, and evidence-scored site roles

**Status:** Proposed (design approved by operator 2026-07-06; build not started) · **Spec:**
[271](../feature-specs/271-plan-vs-actual-baselines-incentives.md)

## Context

Spec 270 gave every project a two-level plan (งาน/งานย่อย) and the 2026-07-06 schedule fill dated
all 331 leaves on PRC-2026-004. The app already captures actuals as evidence — server-stamped
photos, append-only labor days, approval events, rework rounds with `internal|client` source — but
nothing compares plan to evidence, plan edits leave no trail, and the `site_owner`/`auditor` roles
(ADR 0071/0072) plus `work_packages.owner_id` are behavior-free. The operator wants: plan-vs-actual
variance, disciplined plan iteration with baseline snapshots, and a checks-and-balances incentive
system (site_owner=time, auditor=quality, WP Owner=own งาน) for a repeating class of ~28-day TFM
builds — with client punch lists priced by PRC and deducted from no-show subcontractors, and
contractors eventually inside the reward system.

A 4-lens adversarial judge panel (game-theory, data-reality vs the live DB, architecture doctrine,
field adoption) reviewed the first draft: 25 findings, 10 high — including two inverted incentive
gradients and three live-data disproofs. The decisions below are the post-panel design; the panel's
four material revisions were re-approved by the operator (spec 271 Δ1–Δ4).

## Decision

1. **Actuals are derived from evidence, never stored on the WP row.** `actual_start` = earliest
   current during-photo / low-lag labor day (entry lag ≤ 3 days) / after-photo; `actual_end` = the
   submit (pending_approval entry) of the round that ends approved. Bangkok-tz, supersede-aware
   reads. Leaves without evidence classify as explicit `no_evidence` / `completed_undated` /
   `unplanned` classes — never red, never fabricated zeros.
2. **Completion anchors at submit, not approval.** PM review latency is a PD metric, not owner
   slip. An internal reopen ≤7 days after a round closes voids that round's anchor (anti
   approve-early laundering), and per-approver early-approve rates are visible.
3. **Two lenses, one anchor.** Operational variance vs the freely-editable current plan;
   accountability variance vs **baseline v1** (append-only `plan_baselines` snapshots). A PD/super
   `scope_change` re-baseline re-anchors only its explicit per-leaf diff; everything else inherits
   v1. Date edits become audited RPC-only writes (direct column grant revoked).
4. **Roles score only on outcomes derivable from captured data.** site_owner: weighted slip vs
   anchor, with four recorded directive levers whose tagged cost is excluded from WP-owner
   efficiency and charged to a visible cost-of-schedule. auditor: distinct งาน with client defects
   minus capped internal-catch credits; per-งาน sign-off is billing currency (stale on client
   reopen), never a score multiplier. WP accountability is polymorphic per งาน (internal user or
   subcontract firm). PM/PD gain displayed counter-metrics (lag, early-approve rate, waives) so no
   unscored hand feeds everyone else's numbers.
5. **Client punch lists are first-class evidence:** PM/PD-only filing with the raw client document
   attached, PRC-priced items with a ≥7-day deadline floor, auditor countersign against the raw
   list, PD-gated waives, and deductions settled only as links to real (reduced) subcontract
   payment rows. Money posture: zero authenticated grant; the firm reads its own items via a scoped
   definer RPC.
6. **Rewards start as scoreboards.** One calibration project (PRC-2026-004, unscored, per-project
   `scoring_go_live`) tunes thresholds and Thai labels; the first scored project starts with
   bindings on day 1; automatic payout (baht or Nova coins) is v2 after calibration — a gamed
   scoreboard costs nothing to fix, a gamed payout costs trust (ADR 0061).
7. **Separation of duties is a stated precondition,** enforced in schema where cheap (a งาน's
   signer cannot be its leaf approver or its client-defect filer) and by staffing otherwise; with
   no distinct auditor, the sign-off duty runs unscored.

## Alternatives rejected

- **Defect-on-unsigned-งาน counts 2× (the original duty floor)** — panel-proven inverted: instant
  rubber-stamping strictly dominates, and the auditor starts lobbying for faster approvals.
- **actual_end = approval `decided_at`** — measures PRC's own review queue (live: ~4 approvals in 5
  days vs 331 leaves) and enables month-end bulk-approve laundering.
- **Anchor = latest approved baseline** — every approval quietly amnesties accumulated slip;
  converges to "always on time".
- **Stored `actual_start`/`actual_end` columns** — a second source of truth that drifts from the
  evidence; derivation + weekly snapshots give the same readability with tamper visibility.
- **Points/baht payout in v1** — metric holes discovered with real money attached require
  clawbacks, which ADR 0061 identifies as the trust-killer for the whole worker-ecosystem arc.
- **Negative-amount `deduction` payment kind now** — `subcontract_payments` has `amount > 0`
  CHECKs, GL posting, and supersede machinery; a signed kind is its own careful money unit later.
- **EVM / critical-path engine** — overkill for a 28-day repeating build; duration-weighted slip
  over a two-level plan is legible to the people being scored.

## Consequences

- Seven schema/code units (+U0 operator bindings, +U7 externally gated on contractor onboarding
  and spec 251 U2) — spec 271 §8; schema numbers `072800+`.
- `can_see_project` gains membership arms for `site_owner`/`auditor` — their first real behavior;
  `/coming-soon` routing ends for both (roleHome → `/site-owner`, `/auditor`).
- New audited transitions (submit, hold, date edits) grow `audit_log` volume modestly and unlock
  the anchor/lag metrics.
- The billing surface consumes sign-off currency (warn-only v1); certify flows are otherwise
  untouched.
- wp_profit visibility stays PD/super until ADR 0060 dials are tuned; scoreboards carry no ฿
  except the firm's own deduction items.
- Extends ADR 0060/0061 (reward doctrine), 0067/0051 (portals), 0072 (roles), 0074 (hierarchy);
  amends spec 217's reopen RPC gate and the spec 92 schedule RPC.
