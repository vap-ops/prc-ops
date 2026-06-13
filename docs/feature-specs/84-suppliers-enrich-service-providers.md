# Spec 84 — Contacts v2 Unit 2: suppliers enrichment + service_providers table

Contacts v2 program, Unit 2. DB-only, additive.

## Suppliers (ผู้ขาย) enrichment

`alter table suppliers add` contact_person, email, mailing_address, tax_id, payment_terms (all nullable text + length CHECK). Extend the column-scoped INSERT/UPDATE grants (masters_notes precedent). Rides the existing suppliers policies (eval-once-wrapped) — no policy touched. FK `purchase_requests.supplier_id` unchanged.

## service_providers (ผู้ให้บริการ → รถขนส่ง) — NEW table

Operator: build now as a standalone directory (รถขนส่ง/transport). Mirrors the masters pattern (clients/suppliers/contractors): mutable, PM/super-managed, **no delete** (ADR 0033/0038 posture), `created_by` pinned, no `appsheet_writer` grant (ADR 0034 freeze).

Columns: `id` uuid PK, `name` text (nonblank CHECK), `service_subtype` enum (`'transport'`, default; new enum, extensible later), `status` `contact_status` (default `'active'` — reuses the spec-83 enum), `phone`, `contact_person`, `email`, `mailing_address`, `vehicle_type`, `plate_no`, `note` (len ≤ 2000), `created_by` → users, `created_at`. Text columns get length CHECKs.

RLS: enabled, revoke-all-then-grant. SELECT to staff (site_admin, project_manager, super_admin); INSERT/UPDATE to pm/super with `created_by = (select auth.uid())`. **All role checks authored eval-once-WRAPPED** `(select public.current_user_role())` from day one (pgTAP file 40 scans all policies — a bare call fails it). No delete grant/policy. Only inbound-from FK is `created_by → users` (greenfield; zero inbound references → FK-risk-free; bank columns come in Unit 3).

## Migration `20260628000100_suppliers_enrich_service_providers.sql`

enum `service_subtype`; alter suppliers + grants; create service_providers + RLS + grants.

## Tests

- pgTAP `26-...`: + suppliers new columns exist + `has_column_privilege` INSERT/UPDATE; bump plan.
- NEW pgTAP `44-service-providers.test.sql`: table exists + RLS enabled; policies_are (the 3, no DELETE); `has_table_privilege(authenticated, DELETE)=false`; blank name CHECK; status defaults active; service_subtype defaults transport; PM inserts; SA cannot insert; staff SELECT; visitor sees none; created_by pinned. (eval-once auto-covered by file 40.)
- `db:types` regen reconcile byte-exact.

## Verification

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `pnpm db:test` green.
