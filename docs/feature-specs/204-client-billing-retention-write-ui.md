# 204 — Client billing + retention write UI (งวด claims)

Status: SHIPPED (2026-06-25, code-only — no schema). Backend = spec 149 U5 (shipped).
Relates: ADR 0057 decision 8 (posting), spec 166 (accounting beta gate), audit gap **G10**.

## Why

Spec 149 U5 shipped the entire client-billing + retention **backend** — the
`client_billings` / `retention_receivables` tables, the
`create_client_billing` / `certify_client_billing` / `mark_retention_due` /
`release_retention` RPCs, the GL-posting enqueue triggers, and the read-only
registers at `/accounting/billings` + `/accounting/retention`. There is **no UI**
to create a progress claim, certify it (book AR + revenue + output VAT + WHT, and
accrue the withheld retention), mark retention due, or release it. So the GL has a
cost side but **no revenue side**: no AR, no income, no closeable P&L. This unit
adds the missing write surfaces. **Code-only — no schema** (every RPC, table, and
trigger already exists and is pgTAP-tested, files 85/86).

## Scope

- **Pure** `src/lib/accounting/billing-actions.ts`: status predicates
  `canCertifyBilling` (draft|submitted), `canMarkRetentionDue` (held),
  `canReleaseRetention` (held|due) — mirror the RPC guards, drive which controls
  render. Shared `AccountingActionResult` type.
- **Server actions** (gate on the AUTHED session, mirroring
  `app/accounting/periods/actions.ts`; the billing RPCs gate `pm/super`, so the
  action gate is `['project_manager','super_admin']`; call the RPC on
  `auth.supabase`, map errors to a Thai generic, `revalidatePath`):
  - `src/app/accounting/billings/actions.ts`: `createClientBilling`,
    `certifyClientBilling`.
  - `src/app/accounting/retention/actions.ts`: `markRetentionDue`,
    `releaseRetention`.
- **UI:**
  - Billings page — a "+ สร้างงวด" create form (project picker, gross, retention/
    VAT/WHT rate inputs defaulting 5/7/3, optional period, note) with a **live
    breakdown preview** via `computeBillingBreakdown`; a "รับรอง" (certify) button
    on rows where `canCertifyBilling(status)` (confirm: books revenue + posts GL).
  - Retention page — "ครบกำหนด" (mark due, with date) on `held` rows; "คืนเงิน"
    (release) on `held|due` rows (confirm: releases cash + posts GL).
  - Write controls render only when `ctx.role ∈ {project_manager, super_admin}`
    (beta: just super_admin reaches the page; auto-widens when spec 166 re-adds PM).

## Out of scope

- Widening certify to the `accounting` role (spec/RPC = pm/super; a follow-up if
  the operator wants accounting to certify).
- draft→submitted transition UI (certify accepts both; submit step deferred).
- Invoiced/paid lifecycle; WHT-cert auto-record at certify (that is G11 / 149 U6).
- Auto held→due at warranty end (projects carry no warranty_end date yet — manual
  mark-due, per the `release_retention` migration note).

## Verification

- `tests/unit/billing-actions.test.ts` green (predicates).
- `pnpm lint && pnpm typecheck && pnpm test` green.
- Preview: `/accounting/billings` renders the create form + live breakdown and a
  certify control; `/accounting/retention` renders mark-due/release on the right
  rows. Screenshot to Telegram.
- Existing `tests/unit/client-billing.test.ts` + pgTAP 85/86 already cover the math
  and the RPCs.
