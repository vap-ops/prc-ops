// Spec 186 U1 — the pure builder behind the bank-change approval queue page.
// Joins each pending request to its contractor name (fallback "—") for display.

import { describe, it, expect } from "vitest";
import { buildBankChangeQueue, type BankChangeRequestRow } from "@/lib/approvals/bank-change-queue";

const NAMES = new Map([
  ["c-1", "ห้างหุ้นส่วน ก่อสร้างดี"],
  ["c-2", "ช่างรับเหมา สมชาย"],
]);

function row(
  p: Partial<BankChangeRequestRow> & Pick<BankChangeRequestRow, "id" | "contractor_id">,
): BankChangeRequestRow {
  return {
    bank_name: "กสิกรไทย",
    bank_account_no: "123-4-56789-0",
    bank_account_name: "สมชาย ใจดี",
    created_at: "2026-06-20T08:00:00Z",
    ...p,
  };
}

describe("buildBankChangeQueue", () => {
  it("returns an empty list for no requests", () => {
    expect(buildBankChangeQueue([], NAMES)).toEqual([]);
  });

  it("joins each request to its contractor name and maps the bank fields", () => {
    const result = buildBankChangeQueue([row({ id: "r1", contractor_id: "c-2" })], NAMES);
    expect(result).toEqual([
      {
        id: "r1",
        contractorName: "ช่างรับเหมา สมชาย",
        bankName: "กสิกรไทย",
        accountNo: "123-4-56789-0",
        accountName: "สมชาย ใจดี",
        createdAt: "2026-06-20T08:00:00Z",
      },
    ]);
  });

  it("falls back to — when the contractor name is missing", () => {
    const result = buildBankChangeQueue([row({ id: "r2", contractor_id: "ghost" })], NAMES);
    expect(result[0]?.contractorName).toBe("—");
  });

  it("preserves input order (the page pre-sorts oldest-first)", () => {
    const result = buildBankChangeQueue(
      [row({ id: "a", contractor_id: "c-1" }), row({ id: "b", contractor_id: "c-2" })],
      NAMES,
    );
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
