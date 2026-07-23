import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ReviewQueueList,
  type ReviewQueueRow,
} from "@/components/features/accounting/review-queue-list";

function row(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    sourceTable: "wage_payments",
    sourceId: "d2000000-0000-4000-8000-000000000445",
    projectId: null,
    projectName: null,
    amount: 3200,
    eventDate: "2026-07-10",
    counterparty: "สมชาย ใจดี",
    docCount: 0,
    reviewStatus: "pending",
    openFlagCount: 0,
    docsExpected: "no_path_yet",
    ...overrides,
  };
}

describe("ReviewQueueList (spec 345 U2)", () => {
  it("renders a row with source label, counterparty, baht amount and Thai date", () => {
    render(<ReviewQueueList rows={[row()]} />);
    expect(screen.getByText("จ่ายค่าแรง")).toBeInTheDocument();
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText(/฿?3,200/)).toBeInTheDocument();
  });

  it("links each row to its voucher (spec 345 U3)", () => {
    render(<ReviewQueueList rows={[row()]} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/accounting/review/wage_payments/d2000000-0000-4000-8000-000000000445",
    );
  });

  it("shows the ไม่มีเอกสาร chip only for expected-class rows without docs", () => {
    render(
      <ReviewQueueList
        rows={[
          row({
            sourceTable: "office_expenses",
            sourceId: "0e100000-0000-4000-8000-000000000445",
            counterparty: "ค่ากาแฟ",
            docsExpected: "expected",
            docCount: 0,
          }),
        ]}
      />,
    );
    expect(screen.getByText("ไม่มีเอกสาร")).toBeInTheDocument();
  });

  it("stays silent about docs for the labor family (muster is the evidence)", () => {
    render(
      <ReviewQueueList
        rows={[
          row({
            sourceTable: "wp_labor_costs",
            sourceId: "e1000000-0000-4000-8000-000000000445",
            counterparty: "งานปูกระเบื้อง",
            docsExpected: "not_expected",
          }),
        ]}
      />,
    );
    expect(screen.queryByText("ไม่มีเอกสาร")).not.toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีช่องแนบเอกสาร")).not.toBeInTheDocument();
  });

  it("shows the open-flag count on flagged rows", () => {
    render(
      <ReviewQueueList
        rows={[
          row({
            sourceTable: "stock_receipts",
            sourceId: "a1000000-0000-4000-8000-000000000445",
            reviewStatus: "flagged",
            openFlagCount: 2,
          }),
        ]}
      />,
    );
    expect(screen.getByText("ติดธง 2")).toBeInTheDocument();
  });

  it("renders the Thai empty state when the tab has no rows", () => {
    render(<ReviewQueueList rows={[]} />);
    expect(screen.getByText("ไม่มีรายการในมุมมองนี้")).toBeInTheDocument();
  });
});
