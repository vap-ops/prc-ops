# 206 — WHT certificate recording UI (ใบ ภ.ง.ด.3/53/1)

Status: BUILDING (2026-06-26, code-only — no schema). Backend = spec 149 U6 (shipped).
Relates: ADR 0057 decision 9, spec 204 (sibling billing write UI, the 1:1 template),
spec 166 (accounting beta gate), audit gap **G11**.

## Why

Spec 149 U6 shipped the entire WHT **backend** — the `wht_rates` /
`wht_certificates` tables, the `record_wht_certificate` RPC (computes the amount,
defaults the rate from `wht_rates` by income type, enqueues the GL post for a
`deducted` cert), the GL-posting trigger, the pure `validateWhtCertificate`
validator, and the **read-only** register at `/accounting/wht`. There is **no
write surface**: the validator is orphaned (nothing calls it), and the RPC is
unreachable from the app. So withholding-tax certificates (the ภ.ง.ด.3/53/1
documents) can't be issued in-app.

This is the last missing piece of the accounting back-office write side:
billing-write (G10 ✅ spec 204), manual journal (G8 ✅), WHT-write (G11 ✗).
**Code-only — no schema** (every table, RPC, and trigger already exists and is
pgTAP-tested, file `87-wht-certificates.test.sql`).

### Direction semantics (from the migration)

- **`deducted` (เราหัก)** — we withhold when paying a payee → we owe the Revenue
  Dept, issue ภ.ง.ด.3 (individual) / ภ.ง.ด.53 (company). Requires the payable
  party that the WHT reclassifies from: **a supplier OR a contractor**. Posts to
  the GL (Dr party-payable / Cr WHT-payable).
- **`suffered` (ถูกหัก)** — a client withheld from us → a tax credit asset. A
  **document only** (the WHT-prepaid already posts Dr at billing certify). The
  party is the **client** (optional — informational).

## Scope (single unit U1)

- **Pure helper** `resolveWhtRate(incomeType, override, rates)` added to
  `src/lib/accounting/wht-certificate.ts` — mirrors the RPC's
  `coalesce(p_wht_rate, default_rate)`: returns the override when finite,
  otherwise the `default_rate` for `incomeType` from the passed rate table, or
  `null` for an unknown type. Drives the form's rate auto-fill. TDD (RED first).
  `validateWhtCertificate` itself is unchanged (still the money/amount gate).
- **Write gate = `PM_ROLES`** (the `role-home.ts` SSOT, = pm/super/**project_director**).
  Verified by **live query**: `record_wht_certificate`'s gate was widened to
  include `project_director` by migration `…0751…_project_director_rpc_gates.sql`
  — the _migration file_ shows pm/super, the _live_ RPC admits pd (the "live-body
  re-source trap"). So the journal/G8 precedent applies: reuse `PM_ROLES` /
  `isManagerRole` directly — **do not mint a new role-set literal** (audit rank 2).
  No `wht-actions.ts`; the `RecordWhtInput` type lives in the action file, reusing
  `AccountingActionResult` + `ACCOUNTING_ACTION_ERROR` from `billing-actions.ts`.
  (Note: `BILLING_WRITE_ROLES = [pm,super]` is now **stale vs its live RPC**, which
  also admits pd — a pre-existing under-grant drift; flag as follow-up, do not fix
  here.)
- **Loader** `loadWhtFormData(admin)` in `load-registers.ts` → `{ incomeTypes:
{value,label,defaultRate}[], suppliers, contractors, clients: {id,label}[] }`,
  parallel reads (no waterfall). Writers only.
- **Server action** `src/app/accounting/wht/actions.ts`: `recordWhtCertificate(input)`
  — gate `PM_ROLES` via `requireActionRole`; pre-validate the money with
  `validateWhtCertificate` (reject before the call, like billing's
  `computeBillingBreakdown` gate); call `record_wht_certificate` on
  `auth.supabase` (the SECURITY DEFINER RPC gates the AUTHED role — never the
  admin client, whose null role the gate refuses); map errors to the Thai
  generic; `revalidatePath('/accounting/wht')`. Omit optional args
  (exactOptionalPropertyTypes) rather than pass undefined.
- **UI** `src/app/accounting/wht/record-wht-form.tsx` (`'use client'` — controlled
  inputs, sheet state, submit pending, inline error, live amount preview):
  "+ บันทึกใบหักภาษี" → `BottomSheet` form:
  - direction (เราหัก / ถูกหัก) · ภ.ง.ด. form (3/53/1)
  - income type select (drives the rate via `resolveWhtRate`; rate auto-fills,
    overridable) · rate override input
  - 13-digit tax id · base amount
  - party: `deducted` → payee-type toggle (ผู้ขาย / ผู้รับเหมา) + that table's
    select (**required**); `suffered` → client select (optional)
  - issued date (optional, default today) · note (optional)
  - live preview: `whtAmount` via `validateWhtCertificate`
- **Wire** `/accounting/wht/page.tsx`: `canWrite = isManagerRole(ctx.role)`
  (among ACCOUNTING_ROLES reachers only super_admin is a manager — exactly the
  journal-link gate on the accounting landing); load `loadWhtFormData` for writers
  (parallel with the register); render `<RecordWhtForm>` when `canWrite`. The
  register read is unchanged.

## Out of scope

- WHT-cert auto-record at billing certify (the certify path already posts
  WHT-prepaid; this is manual issuance). A follow-up could link the two.
- Editing / voiding certs — append-only, immutable once recorded (the RPC has no
  update path). No edit UI.
- PDF generation of the ภ.ง.ด. document.
- `pay_source_table` / `pay_source_id` linking (cert → its source payment) — left
  null; a follow-up.
- Consolidating the three identical `['project_manager','super_admin']`
  accounting-write role sets (billing / journal / WHT) into one
  `ACCOUNTING_WRITE_ROLES` SSOT — that is architecture-audit **rank 2**
  (`role-set-ts-dedup`); flag as a follow-up, do **not** refactor here.

## Tests

- `tests/unit/wht-certificate.test.ts`: add `resolveWhtRate` cases (RED first) —
  override wins, default-from-type, unknown type → null. Existing
  `validateWhtCertificate` cases unchanged.
- Verify: `pnpm lint && pnpm typecheck && pnpm test` green. No new pgTAP (no
  schema; the RPC is covered by file 87). Screenshot the form open on
  `/accounting/wht`.
