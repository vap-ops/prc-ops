# Spec 131 — DC onboarding packet (docs, consent, emergency contact)

**Status:** in progress — 2026-06-16. **Type:** data model (PII + consent) + DB
migration (prod). Defines and collects the information/documents required from a
direct contractor, surfaced for PM entry and DC self-service (portal, spec 130).

Operator framing (2026-06-16): **DCs are normally individuals.** Need their ID
card, **consent to run a background check**, bank info + bank-book copy, phone,
**emergency contact** — and "think of what might happen." Requirements **differ
by DC type** (individual day-labor vs `dc_company` firm).

## Design driver: "what might happen → what we hold"

| Scenario                                  | Data needed                                                    | Today                                    |
| ----------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Worker hurt on site                       | emergency contact (name/relation/phone), DOB, insurance        | ✗                                        |
| Pay the right person                      | bank + bank-book copy (name matches ID), PromptPay (opt)       | ✓ bank/bank_book                         |
| Verify identity                           | ID card, ID number, address, background-check consent + result | ✓ id_card/tax_id/addr · ✗ consent/result |
| **We legally hold ID/bank + run a check** | **PDPA consent — dated, recorded, revocable**                  | ✗                                        |
| Dispute / blacklist                       | ID on file, status                                             | ✓ status                                 |
| Tax (50 ทวิ WHT)                          | ID number + address + individual rate                          | ✓ data                                   |

## Consent is a first-class record (the PDPA spine)

Holding ID/bank copies and running a background check requires **documented
consent** under PDPA. Consent is **not a checkbox** — it is a dated, scoped,
**revocable** record (PDPA permits withdrawal): who, when, what scope, and the
signed document. The background-check **result** is a separate PM-only note (the
check is run **manually** off-system — store consent + result, no provider
integration).

## Data model (U1)

### Doc types — extend `contact_doc_purpose`

Today `id_card`, `bank_book`. Add: `consent` (signed PDPA + background-check
consent), `house_registration` (ทะเบียนบ้าน), `insurance` (worker accident /
ประกันสังคม), `company_cert` (หนังสือรับรอง — company DC), `vat_cert` (ภพ.20),
`contract` (สัญญา/ใบเสนอราคา — เหมา). (`ALTER TYPE … ADD VALUE`, own migration;
no enum-pin breakage check — grep `contact_doc_purpose` pins.)

### Emergency contact + DOB — columns on `contractors`

`emergency_contact_name`, `emergency_contact_relation`, `emergency_contact_phone`
(text, length-capped), `date_of_birth` date NULL. PII but **not money** — rides
the existing `contractors` authenticated SELECT grant + RLS (incl. the spec-130
own-row policy, so a DC reads their own). Added to the column-scoped
INSERT/UPDATE grants for staff edit; the DC self-edits via an own-row UPDATE path
(emergency contact is low-risk — direct, unlike bank which stays staged, spec
130 U4).

### Consent record — `contractor_consents`

`id`, `contractor_id` FK, `kind` enum `contractor_consent_kind`
(`pdpa_data`, `background_check`), `consented_at` timestamptz, `recorded_by` FK
users (PM or the DC via portal), `document_id` uuid NULL (→ the uploaded signed
consent attachment), `revoked_at` timestamptz NULL, `created_at`. RLS: the bound
contractor reads own (spec-130 axis); pm/super read all. Writes via RPC
(`record_contractor_consent` / `revoke_contractor_consent`), audited.

### Completeness — pure helper, not a column

`contractorPacketStatus(packet, type)` (pure, TDD) → which required items are
present/missing for the DC's **type** (individual vs company checklist), and a
`complete` boolean. No stored status (derive — avoids drift); the PM contact page

- the portal both render it. The required-by-type lists are named constants.

## Surfaces (U2 — not this unit)

- PM contact page: emergency-contact + DOB fields, consent status + record/revoke,
  the expanded document set, and the **completeness checklist** ("missing: bank
  book, consent").
- `/portal`: DC self-completes — emergency contact (direct), consent capture
  (with the PDPA notice), document upload (storage — needs external-write storage
  RLS scoped to own contractor), and the same checklist nudging "finish your file."

## Units

- **U1 (this unit, data layer):** doc-type enum additions; emergency-contact +
  DOB columns + grants; `contractor_consents` table + RPCs; the pure
  `contractorPacketStatus` helper + required-by-type constants. pgTAP + unit
  tests. Prod migration → operator gate.
- **U2:** PM + portal UI (above) incl. external-write storage RLS for DC doc
  uploads (deferred from spec 130 U2/U4).

## Verification (U1)

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`; pgTAP for the new enum
values, columns/grants, `contractor_consents` shape + RLS (own/staff read; SA
denied; RPC role gates) + record/revoke. Gate → operator confirms → `db:push`.

## Out of scope / seams

- Background-check **provider** integration (manual / store-only for now).
- Company-DC contract amount + installment (the KBank-128 lump-sum track).
- Photo/biometric; per-document expiry reminders (e.g. insurance renewal).
