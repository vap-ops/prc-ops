# Spec 288 — Accounting exports for the external accountant

**Status:** U1 in progress (v1-wrap; accountant bridge)
**Source:** the external accountant is app-blind — there is no export of the GL,
the journal, or receipts, and the PEAK accounting integration is
credential-blocked indefinitely (memory `peak-accounting-integration`). Until
PEAK lands, a plain CSV the accountant opens in Excel is the bridge.

## Problem

Every number the accountant needs already lives in the ledger tables
(`journal_entries` / `journal_lines` / `gl_accounts`), but the only way to see
them is inside the app's `/accounting` screens — which the external accountant
cannot reach and could not reconcile from anyway. They work in Excel/PEAK. There
is no file to hand them.

## Decision

Add plain-CSV export routes under `/accounting/**`, mirroring the two export
routes the app already ships — `src/app/payroll/export/route.ts` (wages) and
`src/app/requests/reports/export/route.ts` (purchase report): a `GET` route
handler, `requireRole` FIRST, RFC-4180 CSV cells, a **UTF-8 BOM** so Excel opens
Thai cleanly, `Content-Type: text/csv; charset=utf-8`, an
`attachment; filename=…` disposition, and `Cache-Control: no-store` (an export is
always a live read).

### U1 — GL journal CSV export (this unit)

- **Route:** `GET src/app/accounting/journal/export/route.ts`.
- **Query params (optional):** `?from=YYYY-MM-DD&to=YYYY-MM-DD`, inclusive both
  ends. Missing / malformed / inverted range → **current month** (Asia/Bangkok),
  the same fallback the payroll export uses (`parsePayrollRange`).
- **Rows:** one CSV row **per journal LINE**, carrying its parent entry's fields
  (the flatten). Columns, in order:

  | #   | Column (Thai header) | Source                                                                                               |
  | --- | -------------------- | ---------------------------------------------------------------------------------------------------- |
  | 1   | เลขที่รายการ         | `journal_entries.entry_no`                                                                           |
  | 2   | วันที่               | `journal_entries.entry_date`                                                                         |
  | 3   | ที่มา                | `journal_entries.source_table` (raw provenance, e.g. `client_receipt`, `manual`, `journal_reversal`) |
  | 4   | อ้างอิงที่มา         | `journal_entries.source_id`                                                                          |
  | 5   | รายละเอียด           | `journal_entries.memo`                                                                               |
  | 6   | รหัสบัญชี            | `gl_accounts.code` (via `journal_lines.account_id`)                                                  |
  | 7   | ชื่อบัญชี            | `gl_accounts.name_th`                                                                                |
  | 8   | เดบิต                | `journal_lines.debit` (2dp)                                                                          |
  | 9   | เครดิต               | `journal_lines.credit` (2dp)                                                                         |

- **Which entries:** `status = 'posted'` only — exactly the set the ledger drill
  reads (`load-ledger.ts`). Reversing an entry inserts a _new_ `posted` entry with
  the opposite legs (`reverse_journal_internal`, `reversal_of` set); the original
  stays `posted`. So a `posted`-only journal is **balanced** (Σdebit = Σcredit
  over any full window) and includes both legs of a correction. Draft manual
  entries (not yet posted) are excluded — they are not real GL yet.
- **Auth:** `requireRole(ACCOUNTING_ROLES)` — `accounting` + `super_admin` only
  (the read-only ledger audience, spec 149 U9 / 166). Field/PM roles never reach
  it (money, spec 46).
- **Read path:** the **admin (service-role) client behind the role gate**, _not_
  the RLS-respecting server client. `journal_entries` / `journal_lines` are
  RLS **zero-grant** (no authenticated SELECT, no SELECT policy — ERD audit M5,
  pgTAP-locked); the RLS-respecting client returns **zero rows**. This is the
  only sanctioned journal read path — every existing journal reader
  (`load-ledger`, `load-manual-journals`, `load-voucher`) uses the admin client
  behind `requireRole`. The new read site is registered in
  `src/lib/accounting/money-read-policy.ts` (FIRM_WIDE — the accountant audits the
  whole firm; guard: `money-read-guard.test.ts`).
- **No UI button in U1.** The route is directly hittable (the accountant is handed
  the URL, or a later unit adds a download link). A link would live on an
  accounting-gated surface, never on the PM-gated `/accounting/journal` page —
  bolting it there would reproduce the payroll page/route gate-drift bug
  (`payroll-export-gate.test.ts`).

**Module split (mirrors the payroll export):**

- `src/lib/accounting/journal-export.ts` — **pure** (no I/O): the flatten types,
  `journalEntriesToCsv`, `buildJournalFileName`, `parseJournalRange`,
  `monthRangeOf`. Unit-tested directly.
- `src/lib/accounting/load-journal-export.ts` — `server-only`; the admin-client
  read (`loadJournalExportRows(admin, range)`), returning the nested
  entries-with-lines the pure serializer flattens.

## U2 — receipts / billings CSV export (future unit, NOT built now)

The same idiom for the money the firm has **billed and received**:
`client_billings` (billed) + client-receipt journal entries (received), one row
per document, with project, invoice/receipt no, date, gross/VAT/net, and
outstanding. Same `ACCOUNTING_ROLES` gate, same admin-client-behind-gate read
(both are registered money tables), same BOM CSV. Deferred — U1 (the journal, the
accountant's spine) ships first; U2 is a follow-up once the accountant confirms
the journal format works for them.

## Verification (U1)

- `pnpm test tests/unit/journal-export.test.ts` — green (seen red first): flatten
  one-row-per-line, Thai-memo CSV escaping (comma / quote / newline), 2dp
  debit/credit, null memo/source, empty-input → header-only, BOM prefix, filename,
  `parseJournalRange` default-month / custom / inverted-fallback.
- `pnpm test tests/unit/journal-export-gate.test.ts` — the route gates on
  `requireRole(ACCOUNTING_ROLES)` (source-scan pin, payroll/report style).
- `pnpm lint && pnpm typecheck && pnpm test` — all green.
- Real-flow: `GET /accounting/journal/export?from=…&to=…` returns `200`,
  `text/csv; charset=utf-8`, BOM + header + one row per posted line in the window;
  an anonymous / non-accounting caller is redirected by `requireRole`.
