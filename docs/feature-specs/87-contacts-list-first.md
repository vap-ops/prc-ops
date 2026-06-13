# Spec 87 — Contacts v2 Unit 6: list-first UI (5 tabs, add-sheet, status)

Contacts v2. Code-only. Delivers the operator's headline ask: the contacts page is a **list**; press **Add** to add (a bottom sheet), and the full taxonomy shows as five tabs with status badges + a status filter.

## RecordManager (shared) — two additive props

- `addInSheet`: render an **Add** button that opens the add form inside a `BottomSheet` (spec 78) instead of the always-visible AddCard. AddCard gains `bare` (drop the CARD wrapper/heading inside the sheet) + `onDone` (close on success). Defaults preserve the old inline behavior + existing tests.
- `rowBadge(row)`: an optional `{ label, tone: "amber" | "red" }` chip beside a row's name.

Failing tests first: Add-button opens the sheet (fields hidden until pressed); rowBadge renders a chip.

## ContactsTabs — 5 tabs

ลูกค้า / ผู้ขาย / ผู้รับเหมา / DC / ผู้ให้บริการ. **ผู้รับเหมา and DC are the one contractors table**, split by `contractor_category` in `page.tsx` (`contractors` vs `dc` arrays). Per-type field schemas (the spec-86 `select` primitive drives status/subtype):

- contractors: name, **status** select (ปกติ/ทดลองงาน/บัญชีดำ = active/probation/blacklisted — the operator's "ประจำ/ทดลองงาน/บัญชีดำ"), phone, contact_person, email, mailing_address, tax_id, specialty, note. Create injects `contractorCategory="contractor"`.
- DC: name, **ประเภท DC** subtype select (DC บริษัท/ประจำ/ชั่วคราว), status select, + contact fields. Create injects `contractorCategory="dc"`.
- service providers: name, status, phone, contact, vehicle_type, plate_no, note (service_subtype defaults `transport`).
- suppliers: name, phone, contact, tax_id, payment_terms, note. clients: unchanged.

Each tab: `addInSheet`; contractor/DC/service rows show a status badge (`statusBadge`: probation→amber, blacklisted→red) + a **status sub-filter** segmented control (ทั้งหมด/ปกติ/ทดลองงาน/บัญชีดำ, in-memory `useMemo`). Per-row inline edit retained (the detail page comes in the next unit).

`page.tsx` fetches all fields (user session) and maps to `RecordRow.values` (camelCase). Contractors split by category. service_providers added.

## Tests / verification

`record-manager.test.tsx` +2 (addInSheet, rowBadge). `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No DB change.
