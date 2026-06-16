# Spec 132 — DC portal profile self-edit (cashout-scoped)

**Status:** in progress — 2026-06-16. **Type:** portal self-service + DB
migration (prod). Lets a bound DC keep their own **contactability** current from
`/portal`, under the cashout-only lens: the app's job for a DC is to pay them
correctly, so a DC may self-edit only what is needed to stay reachable/payable —
never anything touching money or identity.

## Design driver — the cashout field classification

A DC's relationship with the company is **getting paid**. So each personal field
is classed by what it would cost if the DC changed it wrong:

| Field                                            | Self-edit?                                       | Why                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| phone · email · contact_person · mailing_address | **direct** (this unit)                           | contactability + the tax address on 50ทวิ; low fraud value, helps reach/pay them                                                          |
| emergency contact · DOB                          | direct (shipped, 131 U2b)                        | worker safety, not money                                                                                                                  |
| consent (PDPA / bg-check)                        | direct record/withdraw (131 U2b/U3)              | PDPA right                                                                                                                                |
| documents (id_card/bank_book/…)                  | direct upload (131 U2c)                          | evidence; the bank book proves the payee name                                                                                             |
| **bank** (account)                               | **staged → PM approval** (130 U4)                | the payout target — the fraud vector                                                                                                      |
| **tax_id**                                       | **PM-only, from the uploaded ID card** (decided) | identity/tax field feeding WHT + PEAK; PM verification against the U2c ID card beats DC self-assertion — no self-edit, no staging machine |
| name                                             | **locked** (PM)                                  | legal payee identity; must match bank-account name + WHT docs                                                                             |
| status (active/probation/blacklisted) · subtype  | **locked** (PM)                                  | a blacklisted DC must never un-blacklist itself                                                                                           |
| role / contractor binding                        | **locked** (system)                              | no self-promote, no rebind (claim-once only)                                                                                              |

## Why a column-scoped RPC, not an own-row UPDATE policy

`authenticated` already holds a broad UPDATE **column** grant on `contractors`
(name/status/tax_id/phone/…, spec 83 + 131). RLS gates **rows**, grants gate
**columns** — neither expresses "this caller may update only THESE columns on
their own row." A blanket own-row UPDATE policy would let a DC change their own
**status** (un-blacklist) or **name**/**tax_id**. So self-edit goes through a
`SECURITY DEFINER` RPC that writes ONLY the four contactability columns for
`current_user_contractor_id()` — column scope by construction. Identical reasoning
and shape to `update_own_emergency_contact` (131 U2b). Direct, no staging
(contactability is not money — unlike bank, 130 U4).

## Units

- **U1 (this unit):** `update_own_contractor_profile(p_phone, p_email,
p_contact_person, p_mailing_address)` SECURITY DEFINER RPC (own contractor,
  42501 if unbound); pure `validateContractorProfile` (lengths mirror the
  `contractors` CHECKs — contact_person ≤120, email ≤200, mailing_address ≤500,
  phone ≤30 + a digit; all optional, blank clears; basic email shape); a
  `PortalContactInfo` edit form on `/portal` (tax_id + specialty stay read-only).
  pgTAP + unit tests. Prod migration → operator gate.

## Verification (U1)

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`; pgTAP: the RPC applies
to own row, leaves another contractor untouched, refuses an unbound caller
(42501), and never reaches name/status/tax_id (only the four columns written).
Gate → operator confirms → `db:push`.

## Out of scope / seams

- **tax_id staging** — decided PM-only (entered from the uploaded ID card).
- **bank** — already staged + PM-approved (130 U4); unchanged.
- **emergency contact / insurance / house registration on the portal** — these are
  worker-safety / HR, not cashout. Kept as-is for now; whether to drop them from a
  strictly-cashout portal is an open product question (deferred, not decided here).
