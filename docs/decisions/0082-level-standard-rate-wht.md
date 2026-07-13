# ADR 0082 — Level-standard labor rates + WHT compute model

- Status: Accepted (2026-07-13). Extends **ADR 0060** (WP profit-sharing / money posture, §5 anti-self-dealing), **ADR 0062** (worker = payee), **ADR 0009/0015** (snapshot immutability). Spec 314.

## Context

ADR 0060 §5 deliberately **decoupled a worker's pay from their level**: money-adjacent attributes are set by a disinterested back-office role, never auto-derived, so a worker or their crew-lead cannot inflate their own rate. In practice a `workers.day_rate` came from the crew-flat `crews.default_day_rate` or a hand-typed number; `workers.level` (`senior|mid|junior|apprentice`) was set separately at `confirm_worker_cost` and never touched money.

The operator now wants technicians to **default to daily pay at the standard rate for their skill level**, with the standard rates maintained by the **procurement manager** and rates negotiated either **before or after withholding tax (WHT)**.

## Decision

1. **Standard rate lives in a PM-maintained table** — `worker_level_rates`, one row per `worker_level`, firm-wide. Deriving a worker's `day_rate` from this table does **not** violate ADR 0060 §5: the rate is authored by the procurement manager (disinterested), not self-set. That is exactly the property §5 protects. This ADR records that a _disinterested-authored standard table_ is an approved derivation source.

2. **Gross is the one canonical figure.** Every stored/snapshotted rate (`workers.day_rate`, `labor_logs.day_rate_snapshot`) is **gross** (before WHT). `wht_basis` (`before_wht|after_wht`, per level) is consumed once — at gross-up time in `level_gross_rate(level)` (`after_wht → entered / (1 − pct/100)`). Downstream code never re-interprets basis; it only ever sees gross.

3. **WHT % is a single firm-wide, PM-editable value** (`labor_wht_config` singleton, seeded 3.00), and it is **frozen at labor-log time** (`labor_logs.wht_pct_snapshot`). A later change to the firm % never restates a worked day — consistent with ADR 0009/0015. Payroll splits the frozen gross into WHT/net.

4. **Derivation fires at the existing money gate.** `confirm_worker_cost` (super_admin) sets `day_rate = level_gross_rate(level)` when a standard exists, else leaves it. Re-leveling (`set_worker_level`) does **not** re-price — re-pricing is a deliberate `set_worker_day_rate`. `pay_type` defaults `daily`.

5. **Money-column posture unchanged.** `entered_rate`, `wht_pct`, `wht_pct_snapshot` carry zero authenticated grant (service-role read only); writes are `procurement_manager`/`super_admin` DEFINER RPCs.

## Consequences

- Editing the standard table affects only **future** derivations — existing workers/logs keep their (snapshotted) values. A bulk re-apply is out of scope.
- **GL posting of the WHT-payable liability is deferred** to a later spec (needs the accountant's WHT-payable account code). v1 computes and _displays_ gross/WHT/net only.
- Growing the `worker_level` enum (via ADR) must seed a new `worker_level_rates` row; a pgTAP assert pins the one-row-per-level invariant.
