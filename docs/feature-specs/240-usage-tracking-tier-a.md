# 240 — Usage tracking Tier A (analytics on `audit_log`)

**Status:** design approved (brainstorm 2026-07-01), spec pending operator review → plan.
**Requires:** ADR **0068** (two-tier usage-tracking architecture).
**Research:** `docs/research/usage-data-use-cases-2026-07.md`.
**Scope:** the **Tier-A** half only — derived analytics over the existing `audit_log`. **No new capture table** (that is Tier B, deferred). **No "levels" layer** (a later consumer). No Google-Sheets readout (deferred; readout is in-app + Telegram).

---

## 1. Purpose

Turn the data the app **already writes** (`audit_log`) into four operator-valued
signals, with ~฿0 new capture cost:

1. **Cycle-time x-ray** — where time actually goes on the PR→คลัง spine.
2. **Stuck-instance early-warning** — work that entered a flow and stalled.
3. **Fatigue early-warning** — a *protective* welfare signal, never a productivity score.
4. **Segregation-of-duties check** — one actor performing conflicting money steps.

Readout: actionable items as **in-app worklist tiles**; a weekly **Telegram digest**
(reusing the existing channel). Output framing honors ADR 0068 §5 (anti-surveillance,
self-governance, PDPA).

## 2. Locked decisions (from brainstorm)

| #   | Decision                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Tier A only — derive from `audit_log`; **no `interaction_events` table** in this spec.                                                      |
| D2  | v1 anchors = the **four** purposes above (operator-selected 2026-07-01).                                                                    |
| D3  | Readout = **in-app worklist + Telegram digest.** gsheet deferred.                                                                           |
| D4  | **Levels** are out of scope (a later consumer of these rollups).                                                                            |
| D5  | Fatigue/welfare signals are **protective**, routed to a welfare owner (SA/HR view), **never** a per-person speed/productivity ranking.      |
| D6  | Rollups are **derived + recomputable** (cron-refreshed). They are not source-of-truth and carry no money/PII beyond what their purpose needs. |

## 3. Precondition — audit-log emission coverage (U1)

Process mining stitches `audit_log` rows by `target_id`/`target_table` into ordered
lifecycles. This only works if **every relevant state transition emits an
`audit_log` row.** Some may not today (e.g. receive→stock_in, store issue/withdraw,
DC-payment staging). U1 **audits** the emission coverage for the four purposes and
**patches** the gaps (additive emission only — never altering `audit_log`'s schema or
its ADR-0004 locks). The exact event set the later units rely on is **confirmed in
U1**; U2–U5 finalize their column lists against U1's findings.

## 4. Approach (per purpose)

- **Cycle-time x-ray.** A read-only **process-instance view** per domain (PR first;
  WP, supply-plan next) that orders a single instance's `audit_log` hops with
  inter-hop durations, plus a `pg_cron`-refreshed `analytics_pr_cycle_daily` rollup
  (median/p90 per hop, per project/buyer). Output: a PM analytics surface.
- **Stuck-instance early-warning.** A `pg_cron` job computing last-event-age per
  **open** instance (PRs in `requested`, WPs photographed-not-submitted, supply-plans
  drafted-not-approved, store items received-not-issued, DC payments
  staged-not-disbursed) into `analytics_stuck_instances`. Output: a "stuck queue"
  worklist tile. Reuses the GL-drain `pg_cron` pattern.
- **Fatigue early-warning.** A per-user **daily activity rollup**
  (`analytics_user_activity_daily`: first/last event, active-day flag,
  consecutive-active-day counter) from `audit_log` timestamps. A conservative
  threshold surfaces a **wellbeing check** to a welfare-scoped SA/HR view only — never
  a score, never a ranking, no per-person comparison. Threshold set with the welfare
  owner.
- **Segregation-of-duties check.** A query over `audit_log` actor data joined across
  the money chain (PR raise/approve/receive; worker-bank-edit→disbursement;
  WP-self-approval feeding settlement) flagging conflicting same-actor combinations
  into `analytics_actor_conflicts`. Output: an accounting/super_admin review list.
  Forbidden-vs-delegated combinations calibrated with accounting.

## 5. Units (test-first; each its own session per repo workflow)

- **U1 — audit-coverage audit + patch.** Enumerate which transitions emit
  `audit_log` rows for the four purposes; patch missing emissions (additive). Tests:
  per-patched-transition, an `audit_log` row with the expected action/target.
- **U2 — process-instance views + cycle-time x-ray.** PR-lifecycle view +
  `analytics_pr_cycle_daily` rollup + cron refresh + PM analytics surface. Tests:
  hop-ordering, duration math, rollup aggregation; vitest for the surface.
- **U3 — stuck-instance early-warning.** `analytics_stuck_instances` + cron detector +
  worklist tile. Tests: aging thresholds per flow, tile rendering.
- **U4 — fatigue early-warning.** `analytics_user_activity_daily` + threshold +
  welfare-scoped view. Tests: consecutive-day counter, threshold, RLS scoping to the
  welfare owner; **assert no per-person ranking surface exists**.
- **U5 — segregation-of-duties check.** `analytics_actor_conflicts` + review list.
  pgTAP for each conflict rule; vitest for the list. RLS to accounting/super_admin.
- **U6 — Telegram weekly digest.** A scheduled digest assembling the above rollups
  into one push. Tests: digest composition; send is the existing outbox path.

## 6. Out of scope (YAGNI — list, don't build)

The `interaction_events` table and all Tier-B/UI-telemetry purposes; the levels
layer; the AI-agent substrate; the gsheet readout; per-PII read-ledger; the remaining
Tier-A purposes not in the v1 four (handoff-friction, rework-loop, variant mining,
GL-completeness tripwire, near-miss radar, access-hygiene trail, notification
effectiveness, cross-project benchmarking, material-waste). Surface as follow-up
specs.

## 7. Governance / risk

- **Danger-path:** U1 (audit-log emission via triggers/migrations), U2/U3/U5 (new
  views + `analytics_*` tables = additive migrations), U6 (notifications) all trip the
  autonomous-build fence → **operator-held / PAT-merged after self-review**, not
  silent auto-merge.
- **Schema single-lane:** every unit that adds a migration needs the one shared schema
  lane — serialize; claim it in `LANES.md` with a migration timestamp before starting.
- **`audit_log` is sacred:** U1 only **adds emissions elsewhere**; it never edits
  `audit_log`'s schema or its ADR-0004 triple-lock. The `protect-audit-log.js` hook
  guards the create-migration; do not touch it.
- **PDPA / anti-surveillance (ADR 0068 §5):** U4 especially — protective framing,
  welfare-owner scope, no ranking. Behavioral capture consent basis is an open
  operator/legal decision (not v1-blocking since Tier A reuses already-consented
  domain events).
- **DB lessons:** source any RPC/trigger redefinition from LIVE; pgTAP `plan(N)` +
  42501 + anti-join patterns; rollup refresh idempotent.

## 8. Open questions (operator)

1. **Consent basis** for behavioral capture (opt-in vs legitimate-interest) — needed
   before Tier B; Tier A proceeds on already-consented domain events.
2. **Fatigue threshold + welfare owner** — who sees the wellbeing check, and at what
   consecutive-day count (set with HR/SA).
3. **Forbidden-vs-delegated** actor combinations for U5 (calibrate with accounting).
