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

4. **Location is derived from an append-only movement log.**
   `equipment_movements` records custody events (received-from-owner,
   deployed-to-WP, returned-to-owner, sent-to-maintenance, lost) with a quantity
   and an optional `work_package_id`. Current location/holding = the latest
   non-superseded movement (anti-join, [ADR 0009](0009-supersede-query-correction.md)),
   never a mutable location column. Full chain of custody, the same posture
   evidence tables already use.

5. **Two money layers, both off the field surface (P2).**
   - `equipment_rental_batches` — the inbound deal: PRC rents N units from an
     owner for a period at a rate. PRC's cost.
   - `equipment_wp_allocations` — the outbound charge: a unit (or bulk qty)
     assigned to a WP for a period at the fee rate billed to the WP owner.
   - `wp_equipment_costs` — a **frozen per-WP snapshot**, written by a
     `freeze_wp_equipment_cost(p_wp)` SECURITY DEFINER RPC that mirrors
     `freeze_wp_labor_cost` exactly (pm/super/procurement gate on the
     authenticated session; audit row carrying old/new; UPSERT). It joins labor
     and materials in the spec-100 budget-vs-spend.

6. **Money posture = the labor posture, copied.** Every ฿ field —
   `equipment_items.acquisition_cost`, batch rates, allocation fee rates, the
   frozen WP cost — has **zero authenticated grant**, is read only via the admin
   client behind `requireRole(pm/super/procurement)`, is **never** rendered on a
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

8. **WP-centric surfacing.** Equipment-in-use appears on the WP detail;
   `work_packages.owner_id` is the fee bearer.

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

**Neutral** — intercompany economics (real cash PRC → sister co vs internal cost
allocation) and rate basis (day / month / flat) are P2 decisions, designed-for
but deferred; depreciation and maintenance-cost accounting are out of v1 (the
register holds `acquisition_cost`; deeper asset accounting is later, likely
PEAK / spec 129 territory).

## Open questions (confirm before the relevant unit)

- **Owner host table** (decision 3) — RESOLVED (spec 141, 2026-06-18): a
  dedicated `equipment_owners` master (`owner_id` FK), not a contacts-master
  subtype.
- **Rate basis** (P2 / U4) — per-day vs per-month vs flat-period; sets the batch
  and allocation rate columns.
- **Real intercompany cash vs internal allocation** (P2 / U4) — does PRC actually
  disburse to the sister co (then this ties to spec 127/128 payment + spec 129
  PEAK), or is the batch cost an internal recovery figure only?
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
