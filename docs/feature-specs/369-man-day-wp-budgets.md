# Spec 369 — WP labour budgets in man-days, surplus to Nova coins

Implements **[ADR 0085](../decisions/0085-man-day-wp-budgets-and-surplus-coins.md)**.
Sits on the built-but-unfed economics of [ADR 0060](../decisions/0060-project-profit-sharing-nova-coins.md)
(specs [160](160-worker-ecosystem-foundation-stage-0.md) / [161](161-profit-sharing-economics.md) /
[162](162-nova-operator-surface.md)) and the level-standard rates of
[ADR 0082](../decisions/0082-level-standard-rate-wht.md).

**The headline finding: the whole economy is starved by one missing button.**
`derive_muster_labor` skips any worker whose `cost_confirmed_at` is null; the only
RPC that stamps it — `confirm_worker_cost` — has **no caller in `src/`**. So
`labor_logs` is 0, `wp_labor_costs` computes ฿0.00 across all 140 rows, and every
downstream engine (labour budget vs actual, `wp_profit`, `settle_project`,
`distribute_project_coins`) reads zero. U1 is that button; everything else waits
behind it.

## Live baseline (measured 2026-07-28 — re-measure before each unit)

| Fact                                   | Value                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `coin_postings` · `shop_items`         | 0 · 0                                                                                          |
| `workers` with a `level`               | 0 of 31                                                                                        |
| `workers` with `cost_confirmed_at`     | **0**                                                                                          |
| `workers.day_rate`                     | **฿0.00 on all 31**                                                                            |
| `crews.default_day_rate`               | ฿0 on all 4                                                                                    |
| `worker_level_rates`                   | apprentice ฿400 · junior ฿500 · mid ฿600 · senior ฿650, all `active`, human-entered 2026-07-15 |
| `wp_economics` (and so `labor_budget`) | 0                                                                                              |
| `labor_logs` · `wp_labor_costs`        | 0 · 140 rows all ฿0.00                                                                         |
| `muster_attendance`                    | 123 rows, 2026-07-24 → 07-27                                                                   |
| `muster_team_wps`                      | 5                                                                                              |
| Material delivered                     | ฿2,467,118 (519 PRs) — **14% WP-attributable**, 86% project-only                               |
| `nova_dials`                           | 9, all seeded placeholders, `updated_by` null                                                  |

Worker composition: **16 daily PRC-paid** (14 temporary + 2 permanent) · 3 daily tied
to a contractor firm (their firm pays them — correctly rate-less) · 12 monthly
permanent (paid off-app; the roster UI forces their rate to 0 by design).

## Units

### U1 — the cost-confirm door (THIS unit; unblocks everything)

`/workers` (รายชื่อช่างและค่าแรง) gains a **ยืนยันค่าแรง** control on the row edit
sheet that calls `confirm_worker_cost(worker, level)` — which sets the level, derives
`day_rate` from `worker_level_rates` via `level_gross_rate`, and stamps
`cost_confirmed_at` / `cost_confirmed_by`.

- **Gate: `super_admin` only.** The RPC raises 42501 for everyone else — narrower than
  the page's `WORKER_ROSTER_ROLES`, so the control renders only for super_admin rather
  than offering-then-refusing (the spec-187 affordance-then-refuse defect).
- Show the rate the confirm **will** stamp before pressing (read `worker_level_rates`
  for the picked level), so the operator is never guessing. `/settings/labor-rates`
  already computes this preview — reuse the derivation, do not re-roll it.
- The existing `set_worker_level` and `set_worker_day_rate` paths stay for the ungraded
  and manual-override cases. **Do not** silently reroute them; confirm is a distinct,
  additional action with its own audit `kind` (`cost_confirm`).
- Surface the unconfirmed state on the row (`/team/roster` already derives
  `cost_confirmed_at is null` — reuse that discriminator's meaning, keep the wording
  consistent).

**Acceptance is a fill-rate query, not a green suite:**
`select count(*) filter (where cost_confirmed_at is not null) from workers where contractor_id is null and pay_type = 'daily'` — must move off 0.

**Out of scope:** bulk confirm; changing either existing RPC; anything touching rates
themselves.

### U2 — grade and confirm the 16 daily workers (operator data op)

Not a build. With U1 shipped, the operator grades each of the 16 PRC-paid daily
workers; the rate follows automatically from the ฿400/500/600/650 table. Then close a
muster day and confirm `derive_muster_labor` writes its first `labor_logs` rows.

Gate on: `labor_logs` count > 0, and `wp_labor_costs` showing a non-zero `dc_cost`.

### U3 — measure the real cost mix (analysis; produces the denomination decision)

With ~2 weeks of confirmed attendance, compute per project and per WP: labour cost vs
WP-attributable material vs equipment; then **back-simulate** what a man-day budget and
its surplus would have been on WPs already finished, and what that surplus converts to
in coins at candidate dial values — i.e. the actual liability.

This is what turns ADR 0085's ~12:1 estimate into a measured ratio, and it is the last
input the operator needs before fixing the dials. **No coin is minted before this unit
reports.**

### U4 — `labor_budget` entry + the man-day presentation

- A PD/PM surface to set `wp_economics.labor_budget` (baht, money audience). Today no
  surface writes it, which is why `wp_economics` is empty.
- A **field-facing man-day view** on the WP: `งบ N วันแรง · ใช้ไป M` derived as
  `labor_budget ÷ standard_day_rate` (new dial). Reuses `laborBudgetSummary`'s
  tone thresholds (amber ≥90%, red over) so the two audiences never disagree.
- **No baht on any field screen.** The man-day numbers are computed server-side and
  only the man-day counts cross the boundary — same posture as every other money
  surface (ADR 0060 §Context).

### U5 — surplus → coins at WP completion (schema)

- `coin_postings.work_package_id` (additive, nullable) so WP-grain surplus is
  attributable; `source_project_id` already exists.
- Two dials: `standard_day_rate` (the U4 divisor) and `coins_per_surplus_man_day`.
- A `super_admin` DEFINER RPC that, at WP completion, computes surplus man-days from
  **confirmed muster attendance only**, floors at zero, and posts via `post_coins`
  under a new `coin_source` — an enum add, which trips the exhaustiveness guards on
  purpose (see `prc-ops-guard-trip-map`).
- Idempotent per WP (a completion may be re-run); vests on the existing tail.

**Blocked on U3 reporting and on the ADR 0085 §3.2 legal opinion.** Design may proceed;
issuance may not.

### U6 — worker-facing surplus view (HELD)

ADR 0061's gift-first rule says a worker's first Nova experience must not be the opaque
coin. Held until the gift bundle exists. The HT-facing man-day view (U4) is not held —
it shows effort, not coins.

## Open questions

- Salaried staff time inside or outside the WP budget (ADR 0085 recommends outside).
- Firm-wide vs per-level `standard_day_rate` divisor (ADR 0085 recommends firm-wide).
- Whether an over-budget WP's overrun carries to the crew's next WP (recommend not).
- Whether `crews.default_day_rate` should seed anything, or be retired as dead.
- The 3 contractor-tied daily workers: confirm they are meant to stay rate-less
  permanently, so U1's acceptance query excludes them correctly.

## Non-goals

- **Coin-denominated budgets** — declined with reasons in ADR 0085 §3. Do not
  reintroduce without answering failures 1 and 2 there.
- Materials or equipment in the reward calculation (86% unattributable).
- Changing `settle_project` / `distribute_project_coins` — project-level profit-share
  is untouched.
- Tuning the other 7 `nova_dials`; that is spec 161's open-dials work.
