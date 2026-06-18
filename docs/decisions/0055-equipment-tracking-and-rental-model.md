# ADR 0055: Equipment tracking & intercompany rental model

## Status

Proposed — 2026-06-18 (operator confirmed: serialized-first hybrid tracking; the
sister company is both the asset owner/investor **and** a user of the system).
Design only — build is spec 141+ (data layer first; **P1 tracking ships before
P2 rental**).

Extends [ADR 0051](0051-external-partner-access-model.md) for the owner-facing
portal. Reuses the `wp_labor_costs` money posture ([spec 68](../feature-specs/68-labor-cost-and-close.md))
and the suppliers/contacts master ([ADR 0038](0038-in-app-purchase-shipment-write-path.md)).

## Context

- Equipment used on sites is **owned by a sister company** that invests capital
  in it. PRC does not own the assets.
- Goal (eventual): PRC **rents a batch** from the sister company, **allocates**
  units to work packages, and **collects a rental fee** from each WP owner. PRC
  is the middle party; recovery = fees out − batch cost in.
- The sister company is an **investor and a system user**: it must see its own
  asset register, where each asset is deployed, utilization, and rental income
  (its ROI) — and nothing of PRC's other data.
- The app already enforces: RLS on every table (no exceptions); append-only
  `audit_log`; supersede for evidence tables; Postgres enums for status; money
  columns at **zero authenticated grant**, read only via the service-role admin
  client behind `requireRole`; **no money on any site_admin-reachable screen**
  (spec 46); external own-row tiers (ADR 0051).

## Decision

**Track serialized assets in an owner-attributed registry, log custody as an
append-only movement stream, and layer intercompany rental as a separate money
domain that rolls a frozen per-WP cost into the existing budget-vs-spend —
reusing the labor-cost money posture and the external-partner portal, not new
mechanisms.**

1. **Serialized-first hybrid registry.** `equipment_items` is the asset spine:
   one row per physical unit (`tracking = 'unit'`, `asset_tag`, quantity
   implicitly 1). A `tracking = 'bulk'` mode carries a `quantity` for genuinely
   fungible, not-individually-taggable stock (scaffold frames, props). Movement
   and allocation quantities are 1 for unit rows. Serialized is the default
   because an investor tracks the _specific asset it bought_.

2. **Category as a lookup table, not an enum.** `equipment_categories` is an
   extensible reference table (excavator, generator, scaffold, formwork, …).
   `status`, by contrast, is a Postgres enum (fixed lifecycle:
   available / on_site / in_use / maintenance / returned / lost) per the project
   rule. Rationale: categories grow operationally; an enum add would need an ADR
   each time, a category insert should not.

3. **Owner = a dedicated `equipment_owners` master, not a hardcoded company.**
   Each item's `owner_id` points at the sister company as a row in a dedicated
   `equipment_owners` table. Single-source; supports more than one owner later.
   **Resolved at build (spec 141, 2026-06-18, operator):** a dedicated master
   rather than reusing `suppliers`/`service_providers` — an investor/lessor is a
   distinct entity, and the future owner portal binds `owner_users →
equipment_owners` the way the DC portal binds to `contractors` (decision 7).

4. **Location is derived from an append-only movement log; equipment attaches to
   a PROJECT.** `equipment_movements` records custody events (received-from-owner,
   deployed-to-project, returned-to-owner, sent-to-maintenance, lost) with a
   quantity and a `project_id` — a _set_ of equipment deploys to a project/site
   and is used across its WPs, **not** allocated to a single WP (operator,
   2026-06-18). Current location/holding = the latest non-superseded movement
   (anti-join, [ADR 0009](0009-supersede-query-correction.md)), never a mutable
   location column. Full chain of custody, the same posture evidence tables
   already use.

5. **Money layers, off the field surface (P2). PRC pays MONTHLY, charges DAILY**
   (operator, 2026-06-18) — a fixed monthly cost recovered by usage-based daily
   charges; returning a set stops the daily accrual, so the monthly commitment is
   the incentive to release idle gear.
   - `equipment_rental_batches` — the inbound deal: PRC rents a set of units from
     an owner for a period at a **monthly** rate. PRC's fixed cost.
   - `equipment_project_allocations` — the deployment: a set attached to a
     **project** (decision 4) for a period; where the monthly batch is committed.
   - `equipment_items.daily_rate` — the **per-item** charge-out rate PRC sets,
     independent of the batch cost (operator's Case A choice, 2026-06-18). Money;
     set via RPC; mirrors `workers.day_rate`. (A P2 ALTER adds it to the U1
     registry table.)
   - `equipment_usage_logs` — the outbound charge basis: **per-item, per-WP,
     per-day** usage (which WP used which item which day) at a
     `daily_rate_snapshot`, mirroring `labor_logs` (worker → item,
     day_rate_snapshot → daily_rate_snapshot). This is the WP split — the daily
     charge is attributed to WPs, not the project as a whole (operator).
   - `wp_equipment_costs` — a **frozen per-WP snapshot** summed from the usage
     logs, written by `freeze_wp_equipment_cost(p_wp)` (SECURITY DEFINER) that
     mirrors `freeze_wp_labor_cost` exactly (pm/super/procurement gate; audit
     old/new; UPSERT). Joins labor + materials in the spec-100 budget-vs-spend.
   - **Re-rental P&L (Case A):** PRC charges an independent daily rate, **not** a
     pass-through split of the ฿50k, so PRC's equipment P&L = Σ(item daily
     charges) − batch monthly cost — real margin when well-utilized, real loss on
     idle items. Equipment is a managed profit center; utilization is the lever.

6. **Money posture = the labor posture, copied.** Every ฿ field —
   `equipment_items.acquisition_cost` + `daily_rate`, batch monthly rates,
   `equipment_usage_logs.daily_rate_snapshot`, the frozen WP cost — has **zero
   authenticated grant**, is read only via the admin client behind
   `requireRole(pm/super/procurement)`, is **never** rendered on a
   site_admin-reachable screen, and is audited. Tracking data (items minus cost,
   movements, categories, location, status) is site_admin-visible so field staff
   can receive and move equipment.

7. **Owner-facing view reuses ADR 0051, on an `owner_id` axis.** The sister
   company logs in as a scoped external tier and sees, via row-level RLS, only
   **its own** items, their deployment/utilization, and the rental income off
   them — through the RLS-respecting client, never the admin client. Same
   dual-policy RLS, same staged-money discipline, same hard-bounded portal
   segment as the DC portal. The owner's **income** is a scoped money read (its
   own earnings only); PRC's margin and every other party stay invisible. This
   is a second ownership axis (`owner_id` → `equipment_owners`) orthogonal to
   ADR 0051's `contractor_id` and ADR 0013's `project_id`.

8. **Project deployment, WP-attributed cost.** A _set_ of equipment attaches at
   the **project** level (decision 4); its **daily** cost is attributed to WPs via
   per-WP usage logs (decision 5), so `work_packages.owner_id` remains the cost
   bearer. Equipment surfaces on BOTH the project (which sets are deployed here)
   and the WP detail (usage + frozen cost). Consistent with the WP-centric
   principle: the project is where the gear lives, the WP is where its cost lands.

## Consequences

**Positive** — reuses three proven mechanisms (labor freeze, external-portal
row-level RLS, supersede/anti-join) instead of inventing; one serialized
register satisfies both PM operational tracking and investor accounting; P1
ships pure tracking with **zero money risk**; the schema is rental-ready so P2 is
additive, not a rewrite.

**Negative** — the hybrid unit/bulk split complicates allocation arithmetic (a
bulk allocation is a quantity against on-hand; a unit allocation is a single
row); the owner portal adds a second external-tier axis to prove **exhaustively**
in pgTAP, like ADR 0051's contractor axis; another money surface to audit on
every future column.

**Neutral** — rate basis is resolved (monthly inbound / daily outbound, decision
5); intercompany economics (real cash PRC → sister co vs internal cost
allocation) remains a P2 decision, designed-for but deferred; depreciation and
maintenance-cost accounting are out of v1 (the register holds `acquisition_cost`;
deeper asset accounting is later, likely PEAK / spec 129 territory).

## Open questions (confirm before the relevant unit)

- **Owner host table** (decision 3) — RESOLVED (spec 141, 2026-06-18): a
  dedicated `equipment_owners` master (`owner_id` FK), not a contacts-master
  subtype.
- **Rate basis & pricing** (P2) — RESOLVED (operator, Case A, 2026-06-18):
  **monthly** inbound (PRC → owner, set-level) / **daily** outbound charged as an
  **independent per-item rate** (`equipment_items.daily_rate`), not a pass-through
  split. PRC P&L = Σ daily charges − batch monthly cost (decision 5). Sets a
  monthly rate on `equipment_rental_batches`, a per-item `daily_rate`, and a
  `daily_rate_snapshot` on `equipment_usage_logs`.
- **WP split rule** (P2 / U5) — RESOLVED (Case A, 2026-06-18): a **per-item,
  per-WP, per-day usage log** (mirror `labor_logs`); each used item-day is
  attributed to a WP at its `daily_rate_snapshot`. (Equal-split and manual
  attribution were the alternatives; the usage log won.)
- **Batch payment mechanism** (P2 / U4) — the re-rental P&L is real (decision 5),
  so the ฿50k/month is a real PRC cost; open: does PRC disburse actual cash to the
  sister co (ties to spec 127/128 payment + spec 129 PEAK) or book it as an
  intercompany entry?
- **Owner access mechanism** (P2 / U6) — a distinct `equipment_owner` external
  role vs generalizing ADR 0051's identity binding to an `owner_contact_id` axis.

## References

- ADR 0051 — external partner access model (the owner portal reuses it)
- ADR 0013 — role-level access (0051's `project_id` axis; this adds an owner axis)
- ADR 0009 — supersede current-state anti-join (movements → current location)
- ADR 0032 / 0033 — WP owner (the fee bearer); contractor-master mirror (registry shape)
- ADR 0038 — suppliers master (the masters posture `equipment_owners` mirrors)
- Spec 68 — `wp_labor_costs` + freeze RPC (money posture and freeze pattern copied)
- Spec 100 — budget-vs-spend (where the frozen equipment cost lands)
