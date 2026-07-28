# ADR 0085: WP labour budgets presented in man-days; surplus converts to Nova coins at WP completion

## Status

**Proposed — 2026-07-28.** Amends [ADR 0060](0060-project-profit-sharing-nova-coins.md)
§3 (settlement grain) and design-rule 2 (opacity); binds to
[ADR 0061](0061-worker-ecosystem-mission-and-foundation-invariants.md)'s foundation
invariants. Extends [ADR 0082](0082-level-standard-rate-wht.md) (level-standard
rates are the derivation source). Implementing spec =
[spec 369](../feature-specs/369-man-day-wp-budgets.md).

Originates from an operator proposal, 2026-07-28: _"For internal WPs, I was
thinking maybe we can create budgets in coins, instead of THB. WP owners will
spend coins and if they are left with any, the sharing begins."_ That proposal is
**declined in its literal form** (§3) and **adopted in substance** (§2).

## Context

### The engine is built and completely unfed

ADR 0060's economics shipped to prod 2026-06-20/21 across specs 160/161/162 —
append-only `coin_postings`, derived balances, `sell_rate_table`, `wp_profit`,
`settle_project`, `distribute_project_coins`, the Nova shop with redemption,
vesting, saver's bonus, narrow confiscation, and the `/nova` operator console with
a dials UI. Measured live on **2026-07-28**:

| Table                                                | Rows                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `coin_postings` (coins ever minted)                  | **0**                                                           |
| `shop_items`                                         | **0**                                                           |
| `workers` with a `level`                             | **0** of 31                                                     |
| `wp_economics` (WP budgets)                          | **0**                                                           |
| `labor_logs`                                         | **0**                                                           |
| `equipment_usage_logs` · `rental_charges`            | **0** · **0**                                                   |
| `project_settlements` · `project_coin_distributions` | **0** · **0**                                                   |
| `wp_labor_costs`                                     | 140 rows, **every one ฿0.00** (recomputed as recently as 07-27) |
| `nova_dials`                                         | 9 rows, **all still seeded placeholders**, `updated_by` null    |
| `boq_template` · `boq_line`                          | **0** · **0**                                                   |

Not a design gap — a **feed** gap. Every mechanism works; nothing reaches it.

### The root cause of the feed gap is a missing button

`derive_muster_labor` (spec 306 U5a) is the RPC that turns closed muster days into
`labor_logs`. Read live, it requires per worker:

```
contractor_id is null
and cost_confirmed_at is not null
and coalesce(day_rate, 0) > 0
and <team has 1..2 WPs>
```

`cost_confirmed_at` is stamped by exactly one RPC — `confirm_worker_cost(worker,
level)`, `super_admin`-gated, which also derives `day_rate` from the level standard
(ADR 0082) and stamps the confirmation. **That RPC has no caller anywhere in
`src/`.** `/workers` can set a level (`set_worker_level`) and can set a rate
(`set_worker_day_rate`), but neither stamps `cost_confirmed_at` and neither derives
one value from the other.

So: 0 workers cost-confirmed → `derive_muster_labor` skips every worker → 0
`labor_logs` → `wp_labor_costs` computes ฿0.00 for all 140 WPs → the labour budget,
the WP profit engine, settlement and coin distribution all read zero. **One missing
door starves the entire economy.** (Previously recorded as a cost-confirmation
_adoption_ problem; it is not — there is nothing to adopt.)

The inputs it would consume already exist: `worker_level_rates` holds real,
human-entered values (apprentice ฿400 · junior ฿500 · mid ฿600 · senior ฿650, all
`active`, entered 2026-07-15), and `muster_attendance` is live (123 rows,
2026-07-24 → 07-27).

### What the cost mix actually looks like

Measured 2026-07-28 over all delivered purchase requests:

| Stream                                                   | Value                               |
| -------------------------------------------------------- | ----------------------------------- |
| Material delivered (519 PRs, 06-23 → 07-27, one project) | **฿2,467,118**                      |
| — attributable to a work package                         | **฿351,081 (14%)**, 131 PRs, 62 WPs |
| — project-only, no WP                                    | **฿2,116,037 (86%)**, 388 PRs       |
| Labour (16 PRC-paid daily workers, est. ฿500 × 22d)      | **≈ ฿176,000 / month**              |
| Material, same basis                                     | **≈ ฿2,100,000 / month**            |

Two facts follow, and they drive this ADR:

1. **WP-grain material budgeting is not possible.** 86% of material baht carries no
   work package, so a WP cannot be charged for most of what it consumed.
2. **Material outweighs labour by roughly an order of magnitude.** A budget that
   includes materials produces a surplus that is ~90% material price variance —
   which the HT does not control (procurement and the store-first flow do).

### What already exists on the labour side

`wp_economics.labor_budget` (baht, zero authenticated grant) has been in the schema
since spec 205, with budget-vs-actual already derived and rendered: `laborBudgetSummary`
(`src/lib/labor/budget.ts`) returns budget · spend · remaining · pctUsed · over ·
tone (amber at 90%, red over), fed by `fetchWpLaborBudgetSummary`
(`src/lib/labor/wp-budget-summary.ts`) via the admin client for the money audience
(PM/PD/super) on the review page and the WP จัดการ tab.

A coin-denominated budget would be a **second** budget system beside a working one.

## Decision

**Keep the WP labour budget in baht where it already lives. Present it to the field
in man-days. Convert only the surplus into Nova coins, at WP completion.**

### 1. The seven rules

1. **The budget stays baht**, in `wp_economics.labor_budget`, money-audience only —
   as built. No new budget store, no second costing path.
2. **The field-facing unit is man-days**: `labor_budget ÷ standard_day_rate`, a dial.
   The HT sees `งบ 40 วันแรง · ใช้ไป 34`. No baht crosses to a field screen — this
   reuses the existing no-money-on-site_admin-screens posture rather than fighting it.
3. **The reward basis is labour surplus at WP completion**, not WP profit at project
   close. This amends ADR 0060 §3 for the labour component only; project-level
   settlement (`settle_project`) is untouched and still governs profit-share.
4. **Materials and equipment are excluded from the reward calculation** — 86%
   unattributable, and outside the HT's control (§Context).
5. **Surplus converts to coins via a dial** (coins per surplus man-day), **floored at
   zero**, vested past the warranty tail. Reuses `post_coins`. A negative balance is
   never representable.
6. **Surplus computes only from worker-confirmed muster attendance**, never from an
   HT declaration. This is a precondition, not a refinement — see §3 failure 1.
7. **No coin↔baht peg.** Coins never denominate a budget, a cost, or a price. The
   man-day presentation and the surplus→coin dial are the two airlocks that keep
   ADR 0060's "abstract points, per-item shop pricing" intact.

### 2. What this adopts from the operator's proposal

The proposal's real insight is **legibility**, and it is correct. ADR 0060's reward
is a hidden P&L settled months later at project close; its own design-rule 2 admits
opacity kills the motivation loop. _"40 given, 34 used, 6 kept"_ is a sentence a
non-accountant holds in his head, and WP completion is weeks away rather than months.
Both properties are adopted in full. Only the **denomination** is refused.

### 3. Why coin-denominated budgets are declined

Ten failure modes, worst first. The first two are sufficient on their own.

1. **It pays the HT to hide attendance.** DCs are paid daily in cash regardless. If a
   WP is charged for man-days, the cheapest move available to the HT is to not log the
   day: the cost leaves his WP, the company still pays it, his surplus rises, and the
   evidence is a _missing row_. This attaches money to suppressing the exact data
   specs 279/306/359 exist to collect. Rule 6 is the only defence — surplus must read
   attendance the worker confirmed.
2. **A pegged coin may be a wage, not a reward.** Once a coin has a derivable baht
   value and is issued for work performed, Thai labour law may treat it as ค่าจ้าง:
   payable in money, in the social-security base, taxable, non-forfeitable — which
   would void confiscation and the externals' lock outright and make every issued coin
   a hard liability. Unpegged abstract points sit far safer on the discretionary-bonus
   side. **This needs a real legal opinion before any build, not after.**
3. **The budget-setter mints the reward.** ADR 0060 §5 already names the WP budget as
   _the root_ discretion point. Coin budgets make it comparable across WPs, so crews
   can infer who is favoured — removing the last layer that made favouritism deniable.
4. **Fixed-price-subcontract incentives.** "Spend less, keep the rest" reliably yields
   understaffing, thinner safety provision, cheaper substitutes, rushing and hidden
   defects. ADR 0060 saw the weak form of this and ruled that "save cost" must mean
   utilization, never penny-pinching; coin budgets make penny-pinching dominant.
5. **The shop becomes a scoreboard of the issuer.** If a coin enters at ~฿1 on the
   budget side and buys ฿0.60 of goods in the Nova shop, that gap is arithmetic anyone
   can do; it reads as theft and gets priced in as a silent discount on all future coin
   earnings — the same death as a whim-revocable currency (design-rule 6).
6. **A frugal HT is not necessarily a good HT.** Fewest men wins for him while idle DCs
   still cost the company daily — ADR 0060 design-rule 3, sharpened. The markup is meant
   to absorb this and is calibrated to utilization, which is currently unmeasured.
7. **Overrun must never go negative.** A negative coin balance is a debt held by a
   daily-paid worker — precisely the debt-bondage pattern ADR 0061's ethics guardrail
   names. Rule 5's floor is architecture, not a setting.
8. **Material dominance rewards luck.** See §Context: ~90% of a WP's cost is material
   the HT cannot price, and 86% of it cannot be attributed to a WP at all.
9. **The externals' invisible lock stops working.** Coin-denominated budgets make WP
   surplus publicly computable. That lever is removable policy under ADR 0061 invariant
   6, so it is spendable — but it should be spent knowingly, not lost by accident.
10. **Launched today it would display fiction.** With every input at zero, every HT
    would appear to spend nothing and keep 100% of every budget.

### 4. Invariant compliance (ADR 0061)

- **(2) ledger-grade** — surplus coins are ordinary `coin_postings`; balance stays
  derived. Requires one additive column (`work_package_id`) so WP-grain surplus is
  attributable; `source_project_id` already exists.
- **(3) pluggable earn-sources** — surplus is a new named source, attaching without
  core surgery.
- **(5) portability** — surplus coins vest and are the worker's to keep, per ADR 0060's
  2026-06-20 trust posture.
- **(6) evolvable transparency** — the man-day view is strictly _more_ transparent than
  the hidden P&L it supplements; it removes no existing disclosure.

## Consequences

- The labour reward loop shortens from project-close to WP-completion; profit-share at
  project close is unchanged and continues to govern the profit component.
- `coin_postings` needs `work_package_id` (additive, nullable). Two new dials
  (`standard_day_rate`, `coins_per_surplus_man_day`). Nothing else structural.
- The cost-confirm door (spec 369 U1) is on the critical path for **every** economic
  feature already built, not just this one.
- The legal question in §3.2 gates go-live, not design. Design proceeds; issuance does not.
- Nothing here changes current behaviour — all affected surfaces read zero today.

## Open questions

- **Salaried staff time.** The 12 monthly workers are paid off-app and never land on a
  WP, so a man-day budget priced on daily workers understates true labour cost. Cleanest
  is to place salaried time explicitly _outside_ the WP budget as company overhead (the
  ADR 0060 design-rule 5 treatment of between-project idle) — but it should be decided,
  not defaulted.
- **Standard day rate for the man-day divisor.** One firm-wide constant (simple, and the
  worker-facing number stays comparable across crews) versus per-level (accurate, but
  the same WP shows different man-day counts for different crews). Recommend firm-wide.
- **Who sets `labor_budget`.** ADR 0060 gives WP budgets to the PD. With `boq_line`
  empty there is no benchmark to derive from, so early budgets are judgment — which is
  failure 3 in miniature. A published rate card × BOQ quantity is the eventual answer.
- **Surplus on an over-budget WP.** Floored at zero (rule 5) — but whether an overrun
  should carry forward against the same crew's next WP is undecided. Recommend not:
  carry-forward reconstructs the negative balance rule 5 exists to forbid.
