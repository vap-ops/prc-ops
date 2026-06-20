# ADR 0060: Project-based profit-sharing via Nova coins (HT/DC self-governance economic model)

## Status

**Proposed — 2026-06-20.** Design only, model v1; **no build yet.** Refined with
the operator over a working session (this ADR is the anchor; implementing specs +
sub-ADRs follow). The reward currency (Nova) revives the held gamification design
([spec 93](../feature-specs/93-settings-hub.md) lineage). Several economic **dials
are deliberately left open** (below) — they are tuned before any money/coin code
ships.

Extends [ADR 0051](0051-external-partner-access-model.md) (external DC portal tier),
relates to [ADR 0055](0055-equipment-tracking-and-rental-model.md) (equipment rental
is a WP expense line; its append-only movement stream is the pattern for DC
project-moves) and [ADR 0057](0057-in-app-general-ledger-feeding-peak.md) (the
WP-dimensioned GL — the profit P&L should DERIVE FROM / reconcile to it, not be a
second costing path).

## Context

The business goal is **self-governance**: make field crews behave like internal
entrepreneurs so they keep themselves productive, instead of being managed
top-down. The lever is a **profit-sharing reward**. Key realities:

- **DC = paid directly, daily** (a payment method), whether working a WP or not →
  idle DC time is a standing company cost. (See the pay-model: company-staff =
  payroll · **DC = we pay daily** · subcontractor/ผู้รับเหมาช่วง = **paid by WP
  contract**, the firm pays its own crew.)
- A **DC belongs to one project at a time**, but is **movable** between projects.
- The app already enforces: RLS everywhere; append-only `audit_log`; supersede for
  evidence; money columns at **zero authenticated grant** (read only via
  service-role behind `requireRole`); **no money on any site_admin screen**. These
  tamper-evident trails are the foundation an objective reward system needs.

## Decision

**Make each work package a profit center, settle the whole project once at close,
and reward the crew in Nova coins — a revocable internal currency whose payouts
flow only from objective, tamper-evident facts, never from discretion.**

### 1. Roles

- **PD (Project Director)** sets each WP's **budget**.
- **PM** assigns **HTs** and grants WP requests.
- **HT (Head Technician)** — a **promoted DC, one per site, exclusive** WP owner;
  requests WPs, runs them, sees the **real WP P&L**, takes the **maximum** coin cut.
- **DC** — daily-paid, one project at a time. **Skill level** (Senior / Mid /
  Junior / Apprentice — set to change) and **tenure** (**Internal = permanent /
  External = temporary**, the `dc_regular` / `dc_temporary` subtypes).

### 2. WP money engine (hidden from non-HT DCs)

```
WP profit = PD budget − (equipment rental + DC labor @ SELL price + materials)
```

- **DC pay (cost) is per individual; sell price is per LEVEL** — a small editable
  **rate table** (one row per level: cost band, internal-WP sell, external-WP sell).
  **The company always keeps the markup**, which funds idle days.
- **Internal WP** (our team) charges the **lower** sell rate; **External WP**
  (assisting a subcontractor) charges the **higher** rate, **netted against what we
  owe the subcontractor**.

### 3. Settlement — project-based, single point (model (b))

WPs **bank** their profit as they complete; the **whole project settles once at
close**: sum the banked WP profits, apply the **project-level multiplier**, and that
is the coin pool. (Daily wage cash and the project profit/coin clock are
**separate** — wages are paid daily as working capital; coins only finalize at close.
This deferral makes vesting nearly free.)

### 4. Coin distribution

- **HT takes a cut off the top**; the **rest splits by level** among the DCs who
  worked the project (Senior→Apprentice; Internal > External).
- **A DC's banked share follows them even after they move** to another project —
  contribution is earned where it was made; moving never forfeits it (or we would
  punish the company-beneficial move).
- **External DCs:** flat, equal share, but **invisible and locked** — unlocked only
  when we **invite** them to become Internal. A silent filter to bring in the right
  people and keep the wrong ones out. (Invisible by choice: we don't advertise it.)
- **Sink:** a **Nova online shop**. Coins are **revocable** — explicit rule
  violations / unfair exit → confiscated. Coins = company authority.

### 5. Anti-favoritism pillar (binding)

**Rewards trace to measured contribution, never to relationships, discretion, or
pleasing power.** Favoritism lives in the **inputs**, not the formulaic payout — so
every discretionary input is objectified or made auditable: WP budget (benchmark to
scope — _the root_), level/grade (objective criteria), HT pick (track-record
shortlist), WP staffing (auditable), external invite (rank by the objective hidden
balance), confiscation (explicit detectable triggers only). **No subjective ratings
anywhere** (no peer/manager points). The append-only `labor_logs` + `audit_log` make
the facts tamper-evident.

## Open dials (tune before building money/coin code)

- **Coin value / Nova shop economics** — what a coin buys; sets the real liability.
  Everything downstream waits on this.
- **The project multiplier** — how the pool flexes with overall project performance.
  Now _the_ most important undefined lever (it scales every payout at close).
- **Markup %** — must be **calibrated to real project utilization**, not picked. The
  case study showed ~8–13% leaks idle badly; ~24% broke even at 81% utilization.
- **HT cut %** and **level weights** — the fairness/aspiration tuning.
- **"Save overall cost → earn more"** — bonus rule; define as **utilization**
  (absorbing idle capacity), not penny-pinching (which invites corner-cutting).
- **Confiscation triggers** — the explicit, narrow list.

## Design rules proven by stress-testing (must hold in any build)

1. **Quality vesting.** Reward profit only after the **warranty/defect window** —
   a defect-reopen ([spec 144](../feature-specs/144-defect-rework.md)) claws back.
   Generalize the externals' lock into a **universal post-close vesting tail** so
   spent coins can't dodge a clawback.
2. **Behavior signals over the hidden formula.** Keep the P&L math hidden, but
   reward **visible objective behaviors** (attendance, on-time, defect-free) with
   clear "+coins" feedback — opacity alone kills the motivation loop, worsened by
   project-close being a very long feedback gap.
3. **Reward utilization, not just WP profit** — else an HT can max a WP's P&L while
   DCs sit idle and the company bleeds (the two ledgers diverge).
4. **External WPs must reward the crew** (pool on the markup margin) — otherwise an
   external-heavy project leaves the busiest crew with zero coins.
5. **Two idle types:** _within-project_ idle the project bears (via markup);
   _between-project_ idle is pure **company overhead** the markup never covers.
6. **Narrow, explicit, rare confiscation** — a currency that can be taken at whim is
   valued at zero. Trust is the currency's foundation; pair revocability with a
   clear vesting/keep path.

## Schema implications (not built; future specs)

The current `workers` schema **contradicts** the model and must change: it
**force-ties a DC to a `contractor_id`** (CHECK `workers_dc_has_contractor`) and has
**no `project_id`**. Target: **DC → Project** association (single current project +
an append-only move history, mirroring [ADR 0055](0055-equipment-tracking-and-rental-model.md)
movements), contractor requirement dropped for DC; add level + tenure; a per-level
sell-rate table; WP budget + internal/external WP attribute; an HT assignment; a
project settlement engine; a Nova coin ledger (append-only) + shop. The WP P&L must
**reconcile to the existing GL** (ADR 0057), not duplicate it.

## Consequences

- A coherent self-governance economic engine that routes **around** patronage —
  objective inputs, formulaic payout, tamper-evident facts.
- Large surface: multiple implementing specs + likely sub-ADRs (coin ledger, sell
  table, settlement engine, shop). Sequenced after the open dials are tuned.
- Nova coins are a **real deferred liability** (shop redemption); issuance must be
  capped as a fraction of real project profit, with breakage (forfeits) reducing it.
- Until built, none of this affects current behavior; the immediate corrective work
  it implies (DC→project, dropping the contractor force-tie) is its own spec under
  this ADR.
