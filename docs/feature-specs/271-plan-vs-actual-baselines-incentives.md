# Spec 271 — Plan vs Actual, baseline snapshots, and site-role incentives (site_owner · auditor · WP Owner)

**Status:** 🎨 **DESIGN — operator-approved 2026-07-06 (in-session Q1–Q6 + revision Δ1–Δ4); BUILD NOT
STARTED.** Units U1+ each need their own session per the one-PR-per-unit loop; U0 is operator data
entry. **ADR:** [0075-plan-vs-actual-baselines-role-incentives.md](../decisions/0075-plan-vs-actual-baselines-role-incentives.md)
**Origin:** operator directive 2026-07-06 — "plan-vs-actual workflow + plan iteration (baseline
snapshots) + site-role incentive system", designed for the repeating TFM-store project class
(~28-day builds), not just PRC-2026-004.
**Adversarial review:** a 4-lens judge panel (game-theory · data-reality · architecture · adoption)
returned 25 findings (10 high) against the v1 draft; all are folded into D5/D7/D8, §3–§8, and the
gaming register §7. The four material changes vs the operator's first answers were re-approved as
Δ1–Δ4 (see §2).

## 1. Problem

Every งานย่อย now carries `planned_start`/`planned_end` (spec 270 + the 2026-07-06 schedule fill:
331/331 leaves dated), and the app already captures rich actuals evidence — photos (server-stamped),
labor days, approval events, rework rounds with `internal|client` source. But:

- Nothing compares plan against evidence beyond the schedule page's two chips. No per-งาน rollup, no
  slippage days, no accountability anchor.
- The plan is silently mutable: `planned_*` edits leave no trail, so "finished in 28 days" is
  unfalsifiable — you cannot reward what a moving baseline measures.
- `site_owner` and `auditor` exist in the role enum (ADR 0071/0072) with zero behavior, and "WP
  Owner" exists only as an unused `owner_id` column. Nobody is accountable *in data* for time or
  quality, and the client punch-list → contractor deduction flow lives entirely off-app.

## 2. Decisions (operator-confirmed 2026-07-06)

| #   | Decision |
| --- | -------- |
| D1  | **Accountable party per งาน, polymorphic.** Each งาน (group WP) names exactly one accountable party: an internal **user** (`work_packages.owner_id`) or a subcontract **firm** (`work_packages.contractor_id`). Both set ⇒ the firm is accountable and the user is the internal steward. งานย่อย inherit their งาน's party. Subcontractor firms get platform users later (self-registration — U7 prerequisite); firm scoreboards exist from day one internally. |
| D2  | **Client defects arrive as an unpriced punch LIST; PRC prices them.** Only PM/PD may file `rework_source='client'`. Intake = `client_defect_lists` (mandatory **raw-list evidence attachment** — the client's actual document/photo/LINE) + `client_defect_items` (leaf-bound, PRC-set price ฿, fix deadline with a **≥7-day floor**). Contractor fixes → paid in full; no-show → priced **deduction**, settled as a link to the real (reduced) `subcontract_payments` row — no negative-amount machinery in v1 (Δ4). `waived` = PD/super only + mandatory reason. The **auditor countersigns** entered items against the raw list (adversarial witness against item splitting/bundling). |
| D3  | **Baselines are append-only versioned snapshots; the incentive anchor is v1.** Live `planned_*` stays freely editable (operational lens). Accountability variance always scores against baseline v1 **except** a PD/super-approved `scope_change` re-baseline, which re-anchors **only the leaves in its explicit item diff** — untouched leaves keep their v1 anchor, and the approval screen shows the blast radius ("N leaves re-anchored, ΣX slip-days absorbed"). site_owner/PM may propose; PD/super approve; reason mandatory. |
| D4  | **site_owner owns TIME with four levers**, each a recorded directive: `overtime`, `hire_own` (force-hire our ช่าง), `replace_team` (request — PM/PD decides, recorded), and resequence authority (current-plan date edits + re-baseline proposals). Counterweight: directive-attributed cost is **excluded from the WP Owner's efficiency** and aggregated into the site_owner's own **cost-of-schedule** metric; PD sees who ordered what and what it cost. Force-hire on a subcontracted งาน auto-notifies the firm. |
| D5  | **Auditor owns QUALITY, scored on outcomes** (Δ1 — replaces the earlier 2×-unsigned rule, which the panel proved inverts into rubber-stamping): score = **distinct งาน with client-reported defects** (granularity-proof against item splitting) **minus internal-catch credits** (an auditor-filed internal reopen whose round closes = a pre-billing catch, positively credited; cap = 1 credit per งาน in v1, a tunable dial). **Sign-off (ตรวจรับงาน)** = one tap + note per งาน, allowed only when the งาน rollup is `complete`; it is **billing currency, not a score weight** — the billing surface warns on unsigned/stale งาน, and a sign-off goes **stale on any client reopen** of that งาน (re-queues). Complete→signed latency is a visible rubber-stamp tell on PD oversight. |
| D6  | **Rewards v1 = scoreboard only.** Full metric visibility (internal boards + a contractor board behind a per-firm `reward_beta` allowlist); deductions are already real money via D2; **no automatic payout formula** until one calibration project has tuned the dials (ADR 0060/0061 — money v2). Operator may hand-pay beta bonuses off the scoreboard. |
| D7  | **Completion anchor = submit time, not approval time** (Δ2): a leaf's `actual_end` is its entry into `pending_approval` for the round that ends approved. PM review lag becomes a PD-oversight metric instead of contractor slip. **Anti-laundering:** an internal reopen ≤7 days after a round closes voids that anchor — slip recomputes to the round that survives; the per-approver reopen-within-7d rate is itself displayed. Rework rounds stay out of schedule slip (they feed quality metrics); a reopened leaf stays *schedule*-complete (anchor exists), never re-enters LATE. |
| D8  | **PRC-2026-004 = calibration pilot, unscored** (Δ3): variance surfaces run live on 004 to tune thresholds/labels/coverage, but accountability scoring starts at a per-project `scoring_go_live`; the first scored project is the next TFM-class build with U0 bindings done on day 1. Rationale: live DB at design time — 0 site_owner/auditor/contractor users, 0/47 งาน bound, 0 labor rows on 004, photos on 32/331 leaves; scoring that is a false-red board. |

## 3. Variance model (pure TS: `src/lib/schedule/actuals.ts` + `variance.ts`)

**Derived anchors per งานย่อย** (never stored on the row; Bangkok-tz via one shared date helper; all
evidence reads are supersede-aware — anti-join + tombstone filter per ADR 0009/0015, labor included):

- `actual_start` = earliest of: first current `during` photo date · earliest current labor
  `work_date` **with entry lag ≤ 3 days** (`created_at::date − work_date ≤ 3`; late/backdated entry
  stays legal for payroll but does not move the metric — anti-forgery) · first current
  `after`/`after_fix` photo date; coalesce to `actual_end` so it is non-null whenever completed.
- `actual_end` = the `pending_approval` entry (submit) of the round that ends `approved` (D7),
  read from the new status-transition audit rows (§4.6). Voided by a reopen ≤7d (D7) — recomputes
  to the surviving round's submit. Rounds predating the transition-audit rows (pre-U3 history —
  incl. 004's existing approvals) fall back to the approval `decided_at`; on scored projects U3
  ships before work starts, so the fallback only ever affects calibration/display data.
- A leaf with status `complete` but no reconstructable anchor (imported/legacy rows) =
  **`completed_undated`**: counted complete, excluded from slip sums — never a fabricated 0.

**Classification — ordered decision table** (first match wins; evaluated against a chosen plan lens —
current plan or a baseline version; weight = `planned_end − planned_start + 1` days, min 1, pinned to
the same anchor version the leaf is scored against):

| # | condition | class (Thai label, labels.ts) |
| - | --------- | ----------------------------- |
| 1 | either planned date NULL | `unplanned` — ไม่มีแผน (excluded from weighted slip; counted separately) |
| 2 | no evidence at all (no photos/labor/approvals) ∧ not complete | `no_evidence` — ยังไม่มีข้อมูล (neutral grey — never red off missing data) |
| 3 | completed (anchor exists) | slip = `actual_end − planned_end` (≤0 on-time/early) |
| 4 | `completed_undated` | complete tally only, no slip |
| 5 | not started ∧ today > planned_end | `never_started_past_end` — ไม่ได้เริ่ม เลยกำหนดจบ (strongest triage signal, ranked above LATE) |
| 6 | not started ∧ today > planned_start | `late_start` — เลยกำหนดเริ่ม |
| 7 | started ∧ today > planned_end | `late` — ช้ากว่าแผน (overrun days) |
| 8 | in_progress ∧ planned_end − today ≤ min(7d, ⌈planned days / 2⌉) | `at_risk` — ใกล้ครบกำหนด |
| 9 | else | `on_track` — ตามแผน |

**Rollups:** per งาน and per project — class counts, max overrun, duration-weighted slip, plus
**evidence coverage %** (leaves with any evidence / leaves past planned_start). งาน rollup pills
suppress red below a coverage threshold (calibrated on 004).

**Scored vs pre-plan work:** baseline v1 rows carry `as_of`; leaves whose `actual_end ≤ as_of` are
`pre_baseline` — displayed, never scored (004: WP-01-06 completed 06-30 against a 07-02 plan must
not bank "9 days early").

**Weekly `variance_snapshots`** (per-leaf class+slip rows written by the existing report job):
trend lines + tamper evidence — a derived actual that moves after being classified is visible as
snapshot drift, closing the silent-supersede rewrite hole.

## 4. Data model (all additive; build claims schema numbers `072800+`)

Money-domain posture throughout: **zero authenticated grant** on price-bearing tables; reads via
admin client behind role gates or scoped SECURITY DEFINER RPCs; writes via definer RPCs writing
`audit_log`; errcode-pinned. New enum values land in their own `NNa` migration file before use.

1. **`plan_baselines`** — `id · project_id FK · version int (unique per project) · kind
   {initial, rebaseline, scope_change} · reason text · as_of timestamptz · scoring_go_live date
   (nullable; on the initial row) · proposed_by FK · approved_by FK · created_at`. Append-only
   (triple-layer like `approvals`).
2. **`plan_baseline_items`** — `baseline_id FK · work_package_id FK (leaf) · planned_start ·
   planned_end` (CHECK end ≥ start; NULL-dated leaves are **omitted** → class `unplanned`).
   Append-only. `kind='scope_change'` versions contain **only the diffed leaves** (D3 inheritance).
   Attach `wp_reject_group_binding`.
3. **`client_defect_lists`** — `id · project_id FK · received_date · channel note · evidence_path
   (mandatory raw-list attachment) · created_by (PM/PD) · auditor_ack_by/at (countersign) ·
   created_at`. **`client_defect_items`** — `id · list_id FK · work_package_id FK (leaf) ·
   description · price numeric (PRC-set) · deadline date (≥ received_date + 7) · status {open,
   fixed_by_owner, fixed_by_us, deducted, waived} · contractor_id + subcontract_id stamped at
   creation (resolved leaf → `subcontract_wps` → subcontract; validated same-firm as the งาน's
   accountable party; NULL subcontract allowed only while open/fixed) · settled_payment_id FK →
   `subcontract_payments` (required for `deducted`) · rework linkage (the item's reopen round) ·
   resolution fields`. Zero UPDATE for authenticated; transitions via definer RPCs; price/deadline
   frozen once the linked client rework round exists or status leaves `open`; `waived` gated PD/super
   + reason. Attach `wp_reject_group_binding`.
4. **`site_directives`** — `id · project_id FK · work_package_id FK (**งาน group** — new inverse
   guard `wp_require_group_binding`: is_group must be true, same project) · type {overtime,
   hire_own, replace_team, resequence_note} · detail · issued_by · issued_at · decision fields
   (replace_team only: decided_by/at/decision/note — **write-once**, BEFORE UPDATE trigger rejects
   any change after `decided_at` set) · created_at`. Rows immutable once issued (append-only
   enforcement); every issue/decision writes `audit_log`.
5. **`wp_signoffs`** — `id · work_package_id FK (งาน — `wp_require_group_binding`) · signed_by
   (auditor) · signed_at · note · rework_state smallint (max child `rework_round` at signing)`.
   Append-only. INSERT trigger: งาน derived status must be `complete`; **self-deal guard**: signer
   must not have approved any leaf of that งาน. **Currency rule:** a sign-off is CURRENT iff no
   later client reopen event exists across the งาน's leaves (compare vs `rework_state` / latest
   reopen audit event); stale งาน re-enter the auditor queue and the billing warning.
6. **Status-transition audit rows** — submit (`pending_approval` entry), approval decisions, hold
   toggles, and `planned_*` date edits (old→new + actor) all write `audit_log` going forward
   (today only reopens do). Powers D7 anchors, PM-lag metrics, and the date-edit trail.
7. **RPC/gate wiring** — `set_work_package_schedule` (real name; there is no
   `update_wp_schedule_dates`): gate += `site_owner`, add `can_see_wp` membership check +
   `is_group` rejection + audit rows; **revoke the direct `planned_start`/`planned_end` column
   UPDATE grant** (RPC becomes the only edit path — precedent: the status/rework_round lockdown).
   `reopen_work_package_for_defect`: gate += `auditor`; role-conditional source rule (auditor +
   site_admin → `internal` only; PM/PD/super → both; **the งาน's signer may not file its client
   defect**). `log_labor_day`: `p_date ≤ current_date` bound + optional `p_directive_id` tag.
   Baseline propose/approve = new definer RPCs (propose: site_owner/PM-tier; approve: PD/super).
8. **Visibility** — `can_see_project` gains membership-scoped arms for `site_owner` + `auditor`
   (via `project_members`, same mechanism as PM/SA — today both roles hard-fall to the ELSE FALSE
   branch, so every surface and RPC membership check is closed to them); `project_members` admits
   the two roles; seeded per project at appointment (U0/U3).
9. **`labor_logs.directive_id`** (nullable FK → site_directives) — SA tags OT/hired days at entry;
   tagged cost routes to the site_owner cost-of-schedule metric and out of WP-owner efficiency.
10. **`contractors.reward_beta boolean not null default false`** — scoreboard allowlist flag.

## 5. Roles & metrics (all from captured data; no money on scoreboards)

| Party | Scored on (accountability lens, vs anchor) | Displayed context (unscored) | Data source |
| ----- | ------------------------------------------ | ---------------------------- | ----------- |
| **site_owner** (TIME) | project on-time % · duration-weighted slip · late/never-started counts | **cost-of-schedule** (directive-tagged labor ฿ — PD view carries the ฿; site_owner sees day counts) · directive log + compliance readouts (headcount before/after on the งาน's leaves, member additions, contractor swaps) | variance lib · site_directives · labor_logs(directive_id) |
| **auditor** (QUALITY) | distinct งาน with client defects (↓) − internal-catch credits (capped/งาน) | sign-off coverage + latency · internal-reopen log with attributed rework labor + slip (PD view) | client_defect_items · reopen audit events · wp_signoffs · labor on rework rounds |
| **WP Owner / firm** (per D1) | own-งาน on-time % + slip vs anchor (directive-tagged cost excluded) | rework rounds by source · defect items + deduction status (own ฿ visible to the firm itself) · wp_profit stays PD/super-only until ADR 0060 dials are set | variance lib · rework_source · client_defect_items |
| **PM / PD** (now measurably in the loop) | — (not incentive-scored v1) | decision lag (submit→decision) · reopen-within-7d rate per approver · waive log · re-baseline approvals + blast radius | approvals + transition audit rows · plan_baselines |

Separation-of-duties preconditions (ADR 0075): auditor ≠ site_owner ≠ the งาน's leaf approver on the
same project; enforced where cheap (schema guards in §4 items 5 and 7), staffing-level otherwise. If a
distinct auditor cannot be staffed on a ≤28-day project, run the sign-off duty **unscored** and
defer the auditor metric to a project that has one.

## 6. Surfaces

- **Roster ตามงาน lens:** variance pill per งาน section header (class counts + worst class), coverage-aware.
- **งาน detail (GroupDetailView):** plan-vs-actual block — planned window, derived actuals, per-leaf class list, slip, directives on this งาน, sign-off state.
- **Schedule page:** existing chips stay (current-plan lens); new **แผนอ้างอิง toggle** = baseline lens; Gantt shows baseline bars ghosted under current bars.
- **/site-owner home:** slip board (worst งาน first) + directive issue/compliance + re-baseline proposal.
- **/auditor home:** sign-off queue sorted by soonest งวดงาน billing (current/stale state) + internal-reopen action + own metric.
- **PD oversight page:** evidence coverage % · PM decision lag · reopen-within-7d per approver · directive cost attribution · re-baseline history + blast radius · snapshot trends · sign-off latency.
- **Subcontract payment surface:** open defect-item ledger per firm (price, deadline, status) + settle-link picker at payment record time.
- **Billing surface:** unsigned/stale-งาน warning (soft gate v1 — warns, never blocks).
- **Contractor portal (U7):** own defect items + own scoreboard (behind `reward_beta`).
- **labels.ts:** every new user-facing term ships in the SSOT and is operator-confirmed **before the first UI merge** (§3 class labels + แผนอ้างอิง / ตรวจรับงาน / รายการแก้ไขจากลูกค้า / คำสั่งหน้างาน). New role-set constants (e.g. `SIGNOFF_ROLES`, `DIRECTIVE_ISSUE_ROLES`, `REBASELINE_APPROVAL_ROLES`, `CLIENT_DEFECT_FILER_ROLES`) live in `role-home.ts`, mirroring each RPC gate exactly.

## 7. Gaming register (attack → design answer → residual)

| # | Attack | Answer | Residual |
| - | ------ | ------ | -------- |
| 1 | Auditor reclassifies client→internal to protect their score | Auditor cannot file `client` at all (D2) | — |
| 2 | Auditor rubber-stamps sign-offs instantly | Sign-off is billing currency, not a score input (Δ1); latency tell on PD page; stale-on-reopen re-queues; client defect on a signed งาน still scores full | Social pressure on PM to bill unsigned — visible via the warning log |
| 3 | Auditor terror-reopens to look diligent | Internal reopens per-count UNSCORED beyond the capped credit; attributed rework cost + slip displayed per auditor; reopen consumes their own queue time | PD judgment call on patterns |
| 4 | PM approves early, work continues as "internal rework" (lateness laundering) | Reopen ≤7d voids the anchor (D7); per-approver reopen-within-7d rate displayed | Laundering past 7d possible but costs a visible rework round |
| 5 | PM splits/bundles punch-list items (vendetta/favor) | Auditor metric counts distinct งาน, not items; raw list attached; auditor countersign; waive = PD+reason | Deduction ฿ still item-granular — contractor dispute path is the check |
| 6 | PM suppresses client defect filing entirely | Deductions are PRC's own money recovery (filing is profitable); operator spot-audit vs the client channel; client portal ack = v2 | **Accepted residual v1** |
| 7 | site_owner directive spam shifts cost onto WP owners | Directive-tagged cost excluded from WP-owner efficiency and lands on site_owner's cost-of-schedule; replace_team needs PM/PD decision | Untagged OT (SA forgets the tag) leaks to the WP owner — coverage checked on PD page |
| 8 | site_owner erases slip via re-baseline | Anchor = v1; scope_change re-anchors only diffed leaves + blast radius shown at approval (D3) | PD lobbying — the blast-radius number is the defense |
| 9 | Baseline sandbagging (padded v1) | v1 = the PD/operator-approved committed plan; TFM contract date anchors the project end | Requires honest first planning — organizational |
| 10 | Backdated labor / staged photos fake `actual_start` | 3-day entry-lag rule on the labor anchor; photos are server-stamped; `p_date ≤ today` bound | A staged during-photo on the day itself — cheap but visible in photo content |
| 11 | Silent history rewrite via labor supersede | Weekly variance_snapshots make post-classification drift visible | — |
| 12 | Contractor rushes a sloppy fix to dodge deduction | Fix closes only through the existing rework verification (after_fix photos + approval); item closure by PM/PD with evidence | — |
| 13 | PRC price-gouges deduction items | Price visible to the firm (portal, U7) + raw-list evidence + ≥7-day deadline floor; dispute via PM/PD note v1 | Formal dispute flow = v2 |
| 14 | One human wears two hats (PD-as-auditor self-dealing) | §5 preconditions + schema self-deal guards (signer ≠ leaf approver; signer ≠ client-defect filer on that งาน) | Staffing reality — flagged to operator per project |

## 8. Units (one PR each; schema lane single-writer, numbers `072800+`)

| Unit | Lane | Contents | Depends on |
| ---- | ---- | -------- | ---------- |
| **U0** | none (operator + SQL-assist) | Appoint real site_owner + auditor users; seed `project_members`; bind D1 party on all 47 งาน of the pilot project (import pattern like the schedule fill) | — |
| **U1** | schema | `plan_baselines` + `plan_baseline_items` + `variance_snapshots` + guards + **004 backfill** (v1 from live dates, `as_of` stamped, pre-baseline marking) + enums file | — |
| **U2a** | code | `actuals.ts` + `variance.ts` (full §3 table, TDD) + roster ตามงาน pills + labels.ts block (**operator confirms Thai terms pre-merge**) + pre-ship 004 audit counts recorded in the PR (complete-without-approval count, no-evidence count) | U1 |
| **U2b** | code | งาน detail plan-vs-actual block + schedule แผนอ้างอิง lens + PD oversight v1 (coverage, snapshot trends) | U2a |
| **U3** | schema | Visibility arms (`can_see_project` + `project_members` for both roles) + `set_work_package_schedule` hardening (+site_owner, membership, is_group reject, audit, column-grant revoke) + reopen gate (+auditor internal-only; signer-guard) + submit/hold/date transition audit rows + `log_labor_day` date bound + baseline propose/approve RPCs | U1 |
| **U4** | schema | `client_defect_lists`/`_items` + definer transition RPCs (errcodes) + intake UI (desktop-first bulk grid; entry split from pricing) + internal deduction ledger on the subcontract payment surface + auditor countersign | U3 |
| **U5** | schema | `site_directives` + `wp_signoffs` (+currency, self-deal guards) + `labor_logs.directive_id` + `contractors.reward_beta` + /site-owner + /auditor homes (roleHome entries) + directive/sign-off UIs | U3 |
| **U6** | code | Scoreboards (site_owner · auditor · per-งาน owner/firm internal) + PM-lag/reopen-rate PD widgets + billing unsigned/stale warning | U4, U5 |
| **U7** | mixed — **externally gated** | Contractor-facing: portal defect transparency (scoped definer RPC) + firm scoreboard behind `reward_beta`. **Prerequisites that do not exist yet:** contractor firm onboarding end-to-end (1 invite ever issued, 0 claimed, 0 contractor users) + minimal subcontract UI (spec 251 U2 never started) | U4, U6 + prereqs |

Every schema unit: pgTAP first (red), migration applied via `db:push` (additive tier), danger-path
guard HELD as designed. Every code unit: failing vitest first. All units re-check `../LANES.md`
before claiming the schema lane.

## 9. Out of scope v1

Automatic reward payout (money v2, ADR 0060 dials) · negative/`deduction` payment kind + GL
(explicit follow-up money unit) · OT pay modeling (`day_fraction` untouched) · inspection checklists
beyond the งาน sign-off · client self-service defect entry (portal v2) · EVM/critical-path engines ·
equipment directive tagging · daily-report generation (spec 212 — variance data will feed it later)
· งาน-level planned dates (270 §7).

## 10. Open items

1. Thai label set §6 — operator confirmation gate before U2a merges (incl. whether ผู้ตรวจสอบ stays
   as the auditor role label).
2. Staffing preconditions §5 per project — operator appoints; if no distinct auditor, sign-off runs
   unscored (D8 note).
3. U7 prerequisites (contractor onboarding e2e; spec 251 U2) — sequence with the operator.
4. Money v2: payout formula + `deduction` payment kind + GL arm + Nova-coin bridge (ADR 0060/0061)
   — after the first scored project.
5. Client-portal defect acknowledgement (closes gaming residual #6) — v2.
