# Nova economy — operator guide

How the Nova coin economy works and how to run it. Non-technical. Everything lives
under **Settings → Nova** (`/nova`), visible to the operator (super_admin) only.

Implements [ADR 0060](decisions/0060-project-profit-sharing-nova-coins.md) /
[spec 161](feature-specs/161-profit-sharing-economics.md).

## The idea in one paragraph

Each **work package** has a budget. When it finishes, its **profit** = budget −
(DC labour at the sell rate + materials + equipment). When a **project closes**, you
**settle** it: the banked profits become a **coin pool** (× the multiplier). You then
**distribute** the pool — the Head Technician takes a cut, the rest splits among the
crew by skill level. Coins are **points** (no fixed baht value); workers spend them in
the **Nova shop**. Coins **vest** after the warranty window — vested coins are the
worker's to keep; only _unvested_ coins can be clawed back (a defect) or confiscated
(fraud/theft/misconduct).

## Before go-live: calibrate the dials (do this first)

Open **Nova → ค่าปรับ Nova (dials)** (`/nova/dials`). Every value is a placeholder —
set them to your real numbers:

| Dial                              | What it does                                                           | Seeded        |
| --------------------------------- | ---------------------------------------------------------------------- | ------------- |
| ตัวคูณเหรียญ (coin_multiplier)    | baht profit → coins. **Tune to real utilization**                      | 1.0           |
| ส่วนแบ่ง HT (ht_cut_pct)          | the Head Technician's cut, off the top (0.15 = 15%)                    | 0.15          |
| น้ำหนัก อาวุโส/กลาง/ต้น/ฝึกหัด    | split weights by skill level                                           | 4 / 3 / 2 / 1 |
| ตัวคูณภายนอก (external_factor)    | weight for external (temporary) workers — keep below the level weights | 1             |
| ระยะสุกงอม (vesting_tail_days)    | the warranty window; coins vest after this                             | 365           |
| อัตราโบนัสออม (savers_bonus_rate) | the saver's-bonus rate (0.02 = 2%)                                     | 0.02          |
| ราคาขายต่อระดับ                   | per-level cost / internal-sell / external-sell (baht)                  | (seeded)      |

The coin multiplier in particular should reflect your billable-vs-idle worker-days —
ask before finalizing it.

## Running a project's payout

Open **Nova → สรุป & แบ่งเหรียญ** (`/nova/settlement`):

1. **Close the project** first (mark it completed). A project that isn't closed shows
   "ยังไม่ปิดโครงการ".
2. **สรุปกำไร** — banks the pool. Shows the pool (coins), the profit basis (baht), and
   how many work packages counted / were skipped (no budget). Once only.
3. **แบ่งเหรียญ** — splits the pool: the HT cut + each worker's share. Once only.
4. If a **defect** later reopens the project's work, **ริบเหรียญ (ตำหนิ)** claws back the
   project's _still-unvested_ coins. Vested coins (past the warranty window) are safe.

## The shop

**Nova → ร้าน Nova** (`/nova/shop`) — add reward items priced in coins, edit prices,
open/close them.

## A worker's coins

Tap any name on the Nova console to open their page (`/nova/worker/[id]`):

- **ยอดเหรียญ** — total, **สุกงอม** (vested = theirs), **ใช้ได้** (spendable), **ยังไม่สุกงอม** (at risk).
- **มอบโบนัสออม** — reward holding (skipped if they spent since their last bonus).
- **แลกของรางวัล** — redeem a shop item for them (spends vested coins only).
- **ริบเหรียญ** — confiscate _unvested_ coins for a listed reason (fraud / theft /
  gross misconduct / defect). Vested coins can never be confiscated.

You can also award coins for good behaviour from the main console (มอบเหรียญ).

## Principles baked in (don't fight them)

- **Vested coins are the worker's** — un-confiscatable. Trust is the currency's
  foundation; confiscation is narrow and explicit.
- **Payouts are formulaic** from measured facts (labour logs) — no subjective ratings.
- **A share follows the worker** across project moves — earned where the work was done.
- **Externals** get a flat share, locked until invited to become internal.

## What's not built yet

- Worker-facing screens (workers seeing their own coins) — deliberately later
  (gift-first: lead with the savings/record/benefits, coins as bonus-on-top).
- Auto-clawback when a defect reopens a WP — clawback is a deliberate operator action.
- Equipment-per-WP refinements beyond the live charge-out already wired in.
