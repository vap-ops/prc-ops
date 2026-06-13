# Spec 83 — Contacts v2 Unit 1: contractor taxonomy + enrichment + DC backfill

Part of the operator-approved **Contacts v2** program (clients · suppliers · contractors · DC · service providers, with a type+subtype taxonomy, richer fields, list+detail UI). This unit lays the contractor data model. DB-only; additive.

## Decision (locked)

- **DC is a classification of `contractors`, not a new table.** A "DC party" already IS a contractors row (`workers.contractor_id → contractors`; `labor_logs.contractor_id_snapshot` groups payroll by it). Two orthogonal axes go on `contractors`:
  - `contractor_category` enum (`'contractor'` | `'dc'`) — the tab discriminator (ผู้รับเหมา vs DC).
  - `contractor_subtype` enum, NULLable — `'regular'` (contractor) or `'dc_company'`/`'dc_regular'`/`'dc_temporary'` (dc), gated by a CHECK to the category.
  - `status` enum `contact_status` (`'active'`|`'probation'`|`'blacklisted'`) — the lifecycle gate. **Probation is a status only** (not a subtype). Blacklist = status, never delete.
- **Enrichment:** add `contact_person`, `email`, `mailing_address`, `tax_id`, `specialty` (nullable text + length CHECK).
- **DC-wins backfill:** any contractor referenced by a DC worker → `contractor_category='dc'` (subtype left NULL for operator triage). A dual-role crew (owns a WP _and_ supplies DC labor) shows under DC.

## Migration `20260628000000_contractor_taxonomy.sql`

- `create type` the three enums (txn-safe; future ADD VALUE = own migration, ADR-0008 lesson).
- `alter table contractors add` the 3 enum columns (category NOT NULL default 'contractor', subtype NULL, status NOT NULL default 'active') + the 5 text columns.
- CHECK `contractors_subtype_matches_category` + length CHECKs on the text columns.
- Extend the column-scoped INSERT/UPDATE grants to `authenticated` (the `masters_notes.sql` precedent). **No RLS policy dropped/created** — the new columns ride the existing contractors INSERT/UPDATE policies (already eval-once-wrapped by `20260625000600`), so pgTAP file 40 is untouched.
- The DC backfill UPDATE.

## FK safety

`work_packages.contractor_id`, `workers.contractor_id` (+ its CHECKs), `labor_logs.contractor_id_snapshot`, all UNCHANGED — this unit only ADDs columns. `worker_type('own','dc')` is untouched and orthogonal (per-person payroll flag vs per-company classification).

## Status writes

For v1, `status`/`category`/`subtype` ride the existing contractors UPDATE policy + the new column grant (PM/super hold UPDATE; the `/contacts` page is PM-gated). **Recorded seam:** an audited `set_contractor_status` SECURITY DEFINER RPC (audit_log trail for blacklisting) — deferred; a plain gated UPDATE is acceptable for v1 (no audit_action enum value needed).

## Tests

pgTAP `24-contractors.test.sql`: + the 3 enum columns exist/typed; + category default 'contractor', status default 'active'; + the subtype↔category CHECK rejects a mismatch (e.g. category='contractor', subtype='dc_company'); + a length CHECK rejects >cap; + `has_column_privilege(authenticated, ...)` INSERT/UPDATE on the new columns; + the DC backfill reclassified a fixture contractor that has a dc worker; + the existing FK still resolves. Bump `plan(N)` exactly. `db:types` regen reconciles byte-exact.

## Verification

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `pnpm db:test` green after `db:push`.
