# Spec 101 — Procurement depth, Unit 1: suppliers screen + desktop nav

**Status:** COMPLETE (2026-06-15; **no DB change**; acceptance = procurement-user phone pass).
**Driver:** operator "what next" → Purchase → **procurement role depth**. Operator chose "both"
(suppliers screen + nav AND project visibility); split into safe units — this is Unit 1 (app-only).
Unit 2 (project visibility) is deferred to its own spec — it needs a migration + a read-only audit of
the capture-heavy WP surfaces (reverses spec 70's deliberate WP-detail bounce).

## Why

Procurement is a supplier writer at the data layer (suppliers RLS admits pm/procurement/super since
spec 33/81) but had **no supplier screen** — it could only add a supplier inline while recording a
purchase, never curate/edit them — and **no desktop nav strip**. This unit gives procurement a proper
suppliers master + a HubNav.

## Key safety decision

The contact **detail page** (`/contacts/[type]/[id]`) shows the money-isolated **bank block**
(PM/super, admin-read). Procurement must NOT see bank. So procurement's supplier list rows do **not**
link to the detail page — they edit **inline** only (`linkDetails=false`). Procurement also can't read
`service_providers` (RLS excludes it), so its view is **suppliers-only**, not the full vendors group.
No RLS change is needed: suppliers SELECT/INSERT/UPDATE already admit procurement.

## What ships (app-only, no migration)

- **`role-home.ts`** — new `BACK_OFFICE_ROLES` = `[project_manager, super_admin, procurement]`
  (matches the suppliers write posture; excludes site_admin).
- **`lib/contacts/groups.ts`** — new `suppliers` group = `["suppliers"]` (procurement's suppliers-only
  subset of vendors).
- **`contacts/actions.ts`** — extracted a generic `roleSession(allowed, msg)`; `createSupplierRecord`
  - `updateSupplierRecord` now gate on `backOfficeSession` (PM + procurement) instead of `pmSession`.
    Clients / service_providers / contractors / bank / documents stay PM-only.
- **`contacts-tabs.tsx`** — new `linkDetails` prop (default true); when false the suppliers rows carry
  no `rowHref` (inline edit only, no bank-bearing detail page).
- **`contacts/vendors/page.tsx`** — gate widened `PM_ROLES` → `BACK_OFFICE_ROLES`. PM/super: both
  tabs + detail links + back→/settings (unchanged). Procurement: `group="suppliers"`,
  `linkDetails={false}`, suppliers fetch only (service skipped), title `ผู้ขาย`, back→/requests.
- **Nav** — `PROCUREMENT_TABS` gains a `ผู้ขาย` tab (`Store`, → `/contacts/vendors`; longest-prefix
  beats the ตั้งค่า `/contacts` match so it lights on the suppliers screen). New `PROCUREMENT_HUB_NAV`
  (คำขอซื้อ · ผู้ขาย · ตั้งค่า) wired on `/requests` (procurement's desktop strip; was null).

## Tests

- `contacts-groups.test.ts` — pins the new `suppliers` group.
- `bottom-tab-bar.test.tsx` — PROCUREMENT_TABS pin += ผู้ขาย; ผู้ขาย lights on /contacts/vendors.
- `hub-nav.test.tsx` — pins PROCUREMENT_HUB_NAV.
- Pages/actions = verified-by-checklist (RLS already admits procurement; the gate widening is the
  change). No money is read on the suppliers screen, so no admin client.

## Seams (recorded)

- **Unit 2 (next): project visibility** — projects SELECT migration + widen /projects + a read-only
  pass over the WP surfaces (so procurement WP rows don't bounce). Reverses spec 70's WP-detail bounce.
- Procurement still can't reach the supplier **detail page** (bank) — deliberate. If procurement ever
  needs supplier bank, that's a separate money-posture decision.
- `/contacts/vendors` keeps its DetailHeader back chip even though procurement also reaches it via a
  tab (harmless redundancy).
