// Writing failing test first.
//
// Spec 373 §5 follow-up — office-expense CSV export, pure module. Same
// contract family as journal-export.ts: UTF-8 BOM so Excel opens Thai clean,
// RFC-4180 escaping, toFixed(2) money, and a filename carrying the month
// scope. Labels come from the SSOTs (payment-source + review-status) — never
// re-invented terms.

import { describe, expect, it } from "vitest";

import {
  buildExpenseExportFileName,
  officeExpensesToCsv,
  paymentSourceLabel,
} from "@/lib/expenses/expense-export";
import { reviewStatusLabel } from "@/lib/accounting/review-queue-view";
import {
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_DIRECT_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";
import type { AllExpenseRow } from "@/lib/expenses/load-office-expenses";

function row(overrides: Partial<AllExpenseRow>): AllExpenseRow {
  return {
    id: "e1",
    description: "น้ำมัน",
    amount: 500,
    expenseDate: "2026-07-01",
    paymentSource: "company_card",
    categoryLabel: "เดินทาง",
    projectName: null,
    cardLabel: "บัตร A",
    reimburseToName: null,
    reimbursedAt: null,
    submitterId: "u1",
    submitterName: "สมชาย ทดสอบ",
    docCount: 1,
    reviewStatus: "pending",
    docsExpected: "expected",
    ...overrides,
  };
}

describe("spec 373 export — paymentSourceLabel (SSOT)", () => {
  it("maps every enum value to its existing label, unknown falls through raw", () => {
    expect(paymentSourceLabel("company_card")).toBe(PAYMENT_SOURCE_CARD_LABEL);
    expect(paymentSourceLabel("own_money")).toBe(PAYMENT_SOURCE_OWN_LABEL);
    expect(paymentSourceLabel("company_direct")).toBe(PAYMENT_SOURCE_DIRECT_LABEL);
    expect(paymentSourceLabel("future_value")).toBe("future_value");
  });
});

describe("spec 373 export — officeExpensesToCsv", () => {
  it("starts with a UTF-8 BOM and the Thai header row", () => {
    const csv = officeExpensesToCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    const header = csv.slice(1).split("\n")[0];
    expect(header).toContain("วันที่");
    expect(header).toContain("บันทึกโดย");
    expect(header).toContain("จำนวนเงิน");
    expect(header).toContain("สถานะตรวจ");
  });

  it("one row per expense: money toFixed(2), SSOT source + review labels, doc count", () => {
    const csv = officeExpensesToCsv([row({ amount: 1234.5, reviewStatus: "verified" })]);
    const line = csv.split("\n")[1] ?? "";
    expect(line).toContain("1234.50");
    expect(line).toContain(PAYMENT_SOURCE_CARD_LABEL);
    expect(line).toContain(reviewStatusLabel("verified"));
    expect(line).toContain("สมชาย ทดสอบ");
    expect(line).toContain("เดินทาง");
  });

  it("RFC-4180: quotes fields with commas/quotes/newlines, doubles internal quotes", () => {
    const csv = officeExpensesToCsv([row({ description: 'ค่า "พิเศษ", แถวใหม่' })]);
    expect(csv).toContain('"ค่า ""พิเศษ"", แถวใหม่"');
  });

  it("null-ish fields render empty cells — the row keeps every column", () => {
    const csv = officeExpensesToCsv([row({ submitterName: null, categoryLabel: null })]);
    expect(csv).not.toContain("null");
    const header = csv.slice(1).split("\n")[0] ?? "";
    const line = csv.split("\n")[1] ?? "";
    expect(line.split(",").length).toBe(header.split(",").length);
  });

  it("formula-injection guard: =/+/-/@ cells are apostrophe-prefixed (lib/csv SSOT)", () => {
    const csv = officeExpensesToCsv([row({ description: '=HYPERLINK("x")' })]);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("reimbursedAt exports as the BANGKOK calendar date, not the raw UTC instant", () => {
    // 2026-07-01T17:30:00Z = 2026-07-02 00:30 Bangkok — the previous UTC date.
    const csv = officeExpensesToCsv([row({ reimbursedAt: "2026-07-01T17:30:00Z" })]);
    expect(csv).toContain("2026-07-02");
    expect(csv).not.toContain("17:30");
  });
});

describe("spec 373 export — buildExpenseExportFileName", () => {
  it("carries the month scope", () => {
    expect(buildExpenseExportFileName("2026-07")).toBe("office-expenses-202607.csv");
    expect(buildExpenseExportFileName("all")).toBe("office-expenses-all.csv");
  });
});
