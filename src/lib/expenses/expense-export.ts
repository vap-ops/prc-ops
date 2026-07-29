// Spec 373 §5 — office-expense CSV export, PURE (no I/O). The journal-export
// contract family: UTF-8 BOM so Excel opens Thai clean, RFC-4180 escaping,
// toFixed(2) money, filename carrying the month scope. Labels come from the
// SSOTs — payment-source from labels.ts (also consumed by <ExpenseSummary>),
// review-status from review-queue-view. The uncapped row read lives in
// load-office-expenses.ts (listAllExpensesForExport); the route gates first.

import { reviewStatusLabel } from "@/lib/accounting/review-queue-view";
import type { AllExpenseRow } from "@/lib/expenses/load-office-expenses";
import {
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_DIRECT_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";

// The payment_source enum → its existing SSOT label (fact-check rule: never
// invent parallel terms). An unknown/future value falls through raw so the
// export degrades legibly instead of lying with a wrong label.
const SOURCE_LABELS: Record<string, string> = {
  company_card: PAYMENT_SOURCE_CARD_LABEL,
  own_money: PAYMENT_SOURCE_OWN_LABEL,
  company_direct: PAYMENT_SOURCE_DIRECT_LABEL,
};

export function paymentSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// RFC 4180: quote a field containing a quote, comma, or newline; double any
// internal quote. (Same rule as journal-export.ts / payroll.ts.)
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const CSV_HEADER = [
  "วันที่", // expense_date
  "บันทึกโดย", // submitter
  "ประเภทค่าใช้จ่าย", // category
  "รายละเอียด", // description
  "โครงการ", // project
  "จ่ายจาก", // payment source (SSOT label)
  "บัตร", // company card label
  "จำนวนเงิน (บาท)", // amount
  "คืนเงินให้", // reimburse target
  "คืนเงินแล้วเมื่อ", // reimbursed_at
  "สถานะตรวจ", // review status (spec-345 label)
  "จำนวนเอกสาร", // doc count
];

/** One CSV row per expense. UTF-8 BOM prefix so Excel reads Thai correctly. */
export function officeExpensesToCsv(rows: ReadonlyArray<AllExpenseRow>): string {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.expenseDate),
        csvCell(r.submitterName ?? ""),
        csvCell(r.categoryLabel ?? ""),
        csvCell(r.description),
        csvCell(r.projectName ?? ""),
        csvCell(paymentSourceLabel(r.paymentSource)),
        csvCell(r.cardLabel ?? ""),
        r.amount.toFixed(2),
        csvCell(r.reimburseToName ?? ""),
        csvCell(r.reimbursedAt ?? ""),
        csvCell(reviewStatusLabel(r.reviewStatus)),
        String(r.docCount),
      ].join(","),
    );
  }
  return "﻿" + lines.join("\n") + "\n";
}

export function buildExpenseExportFileName(month: string): string {
  return `office-expenses-${month === "all" ? "all" : month.replaceAll("-", "")}.csv`;
}
