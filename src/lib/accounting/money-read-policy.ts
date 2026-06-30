import "server-only";

// ERD audit (2026-06-29) — finding M5. The money tables below are RLS
// zero-grant: no authenticated SELECT, no SELECT policy. They are only ever read
// server-side via the service-role admin client, behind a requireRole gate. That
// is the intended, pgTAP-locked posture (the accountant legitimately audits the
// WHOLE firm), so there is no DB-level tenant backstop for money — the project
// (tenant) boundary depends on every reader remembering to scope its query.
//
// This module is the forcing function. Every money-table read site is classified
// here as one of two kinds, and `tests/unit/money-read-guard.test.ts` fails if a
// money table is read from a file that is NOT registered below. A developer can
// therefore never ADD a money read silently — they must consciously declare it
// firm-wide or project-scoped, and a reviewer sees that choice.
//
// FIRM-WIDE reads are correct for the accounting audience (GL / AP / AR / vouchers
// across the whole firm). PROJECT-SCOPED reads serve a single project/WP context
// (a PM looking at one WP's economics) and MUST carry a project_id / work_package_id
// filter so they cannot return another tenant's money.

/** The zero-grant money tables (read only via the admin client behind requireRole). */
export const MONEY_TABLES = [
  "journal_entries",
  "journal_lines",
  "wp_economics",
  "wp_profit_bank",
  "wp_labor_costs",
  "client_billings",
  "retention_receivables",
] as const;

export type MoneyTable = (typeof MONEY_TABLES)[number];

/**
 * Files that read money tables firm-wide — the accountant audits the whole firm
 * (ACCOUNTING_ROLES via requireRole). No project filter is expected or wanted.
 */
export const FIRM_WIDE_MONEY_READ_SITES: readonly string[] = [
  "src/lib/accounting/load-ledger.ts",
  "src/lib/accounting/load-manual-journals.ts",
  "src/lib/accounting/load-payables.ts",
  "src/lib/accounting/load-registers.ts",
  "src/lib/accounting/load-voucher.ts",
];

/**
 * Files that read money tables in a single project/WP context. Each read here
 * MUST carry a project_id / work_package_id filter (verified by review + the
 * scope of the surrounding requireRole gate).
 */
export const PROJECT_SCOPED_MONEY_READ_SITES: readonly string[] = [
  "src/app/review/work-packages/[workPackageId]/page.tsx",
  "src/lib/labor/wp-budget-summary.ts",
];

/** Every file allowed to read a money table. The guard test pins this set. */
export const REGISTERED_MONEY_READ_SITES: readonly string[] = [
  ...FIRM_WIDE_MONEY_READ_SITES,
  ...PROJECT_SCOPED_MONEY_READ_SITES,
];
