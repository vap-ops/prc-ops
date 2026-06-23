# Spec 191 — Contact registration forms, pro-max (phone / VAT / credit terms / tax id)

**Operator (2026-06-24):** "Revise vendor registration… phones should be 10
digits; vendors may be VAT or not; credit terms selectable (cash, 7, 15, 30, 45
days); tax id can be formatted. Think hard about uxui pro max."

Mocked with `show_widget` first, then two forks decided via AskUserQuestion:

- **Scope = ALL four contact forms** (customers, vendors/suppliers,
  subcontractors, service providers) — not vendors only. Phone + tax-id formatting
  are generic; VAT + credit-terms apply where they fit (suppliers + service).
- **VAT ↔ Tax ID = Tax ID always shown, required once VAT is on** (not hide-unless-VAT).

All four forms are the one field-config-driven `RecordManager`
(`SUPPLIER_FIELDS`/`CLIENT_FIELDS`/… in `contacts-tabs.tsx`), so the work is: new
reusable field types + per-form config + server validation + (U2/U3) columns.

## U1 — formatting + validation foundation (NO DB) — SHIPPED

- `src/lib/contacts/thai-format.ts` — pure `digitsOnly` / `formatThaiPhone` (3-3-4,
  validates `^0\d{9}$`) / `formatThaiTaxId` (1-4-5-2-1, validates `^\d{13}$`). Used
  by BOTH the client field inputs and the server actions. Unit-tested
  (`tests/unit/thai-format.test.ts`).
- `RecordManager` field types `+"phone" +"taxid"` — auto-format as you type, inline
  format error, `aria-invalid`; submit blocked on a blank name or any field error
  (`recordHasErrors`). Added `requiredWhenTruthy` to `RecordFieldDef` (drives the
  VAT→TaxID gate in U2; the inline "\*" + required error already honor it).
- Configs: every form's phone `tel→phone`; suppliers + subcontractors tax_id
  `text→taxid`; suppliers `paymentTerms` `text→select` of fixed terms
  (ไม่ระบุ / เงินสด / เครดิต 7·15·30·45 วัน), value === label so the row preview reads
  naturally. payment_terms stays a `text` column (no migration) — the select just
  constrains new input.
- `contacts/actions.ts` — `normPhone` / `normTaxId` validate + canonicalize on
  write for every relevant create/update (defense + paste-safety); blank stays
  optional → null. No DB change.

## U2 — suppliers VAT (DB) — PENDING

- Migration: `suppliers + is_vat_registered boolean` + **column-level insert/update
  grants** (suppliers uses column grants — the spec-174 lesson). New `RecordManager`
  field type `"vat"` (segmented จด/ไม่จด toggle storing "true"/"false"); supplier
  config gets the VAT field + `taxId.requiredWhenTruthy = "isVatRegistered"`.
  Actions map the boolean. pgTAP for the column grants/RLS.

## U3 — service providers parity (DB) — PENDING

- Migration: `service_providers + tax_id + payment_terms + is_vat_registered` (3
  cols + column grants). Wire SERVICE_FIELDS with taxid + credit-terms select + VAT;
  actions handle the new columns. pgTAP.

## Notes

- Customers + subcontractors get phone (and subcontractors tax-id) formatting only —
  no VAT/credit-terms (operator scoped those to vendors/service).
- Concurrent sessions grabbed spec 189 (multi-supply-plan) + 190 (dark mode) mid-build
  → this is 191. U2/U3 migrations follow the [[concurrent-session-hazard]] playbook
  (number above remote, flag before push).
