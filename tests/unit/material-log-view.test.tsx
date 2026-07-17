// Spec 213 U2 — the per-material activity log view. Presentational: it renders an
// assembled MaterialLogEntry[] as a newest-first timeline. Cost-side only (no
// sell/margin — that data never reaches this component).

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialLogView } from "@/components/features/store/material-log-view";
import { buildMaterialLog, type MaterialLogSources } from "@/lib/store/material-log";
import {
  STORE_RECEIVE_LABEL,
  STORE_ISSUE_LABEL,
  STOCK_COUNT_LABEL,
  STORE_RETURN_TO_STORE_LABEL,
  STORE_FIX_WRONG_ENTRY_LABEL,
  RECEIPT_CORRECTION_PENDING_LABEL,
} from "@/lib/i18n/labels";

const sources: MaterialLogSources = {
  receipts: [
    {
      id: "r1",
      at: "2026-06-20T08:00:00Z",
      createdAt: "2026-06-20T08:00:00Z",
      qty: 50,
      unitCost: 30,
      totalCost: 1500,
      actorId: null,
      note: null,
      supplierName: "ร้านวัสดุดี",
    },
  ],
  issues: [
    {
      id: "i1",
      at: "2026-06-21T08:00:00Z",
      createdAt: "2026-06-21T08:00:00Z",
      qty: 10,
      unitCost: 30,
      totalCost: 300,
      actorId: null,
      note: null,
      workPackage: { code: "WP-03", name: "ฐานราก" },
    },
  ],
  counts: [
    {
      id: "c1",
      at: "2026-06-22T08:00:00Z",
      createdAt: "2026-06-22T08:00:00Z",
      countedQty: 38,
      systemQty: 40,
      variance: -2,
      varianceValue: -60,
      actorId: null,
      note: null,
    },
  ],
  returns: [],
  reversals: [
    {
      id: "rv1",
      at: "2026-06-24T08:00:00Z",
      createdAt: "2026-06-24T08:00:00Z",
      qty: 10,
      valueDelta: 300,
      reverses: "issue",
      actorId: null,
      note: "บันทึกเบิกผิด",
    },
  ],
};

describe("MaterialLogView (spec 213 U2)", () => {
  it("renders each movement kind with its Thai label", () => {
    render(<MaterialLogView entries={buildMaterialLog(sources)} unit="ท่อน" />);
    expect(screen.getByText(STORE_RECEIVE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(STORE_ISSUE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(STOCK_COUNT_LABEL)).toBeInTheDocument();
    expect(screen.getByText(STORE_FIX_WRONG_ENTRY_LABEL)).toBeInTheDocument();
  });

  it("shows the signed qty delta with the unit", () => {
    render(<MaterialLogView entries={buildMaterialLog(sources)} unit="ท่อน" />);
    expect(screen.getByText(/\+50\s*ท่อน/)).toBeInTheDocument();
    expect(screen.getByText(/-10\s*ท่อน/)).toBeInTheDocument();
    expect(screen.getByText(/-2\s*ท่อน/)).toBeInTheDocument();
  });

  it("shows the WP code on an issue entry", () => {
    render(<MaterialLogView entries={buildMaterialLog(sources)} unit="ท่อน" />);
    expect(screen.getByText(/WP-03/)).toBeInTheDocument();
  });

  it("renders a return label when a return is present", () => {
    const withReturn = buildMaterialLog({
      ...sources,
      returns: [
        {
          id: "rt1",
          at: "2026-06-23T08:00:00Z",
          createdAt: "2026-06-23T08:00:00Z",
          qty: 4,
          totalCost: 120,
          actorId: null,
          note: null,
          workPackage: { code: "WP-03", name: "ฐานราก" },
        },
      ],
    });
    render(<MaterialLogView entries={withReturn} unit="ท่อน" />);
    expect(screen.getByText(STORE_RETURN_TO_STORE_LABEL)).toBeInTheDocument();
  });

  it("shows the running balance on the newest row", () => {
    render(<MaterialLogView entries={buildMaterialLog(sources)} unit="ท่อน" />);
    // this fixture has no return: 50 → 40 (issue) → 38 (count) → 48 (reversal).
    // The newest entry is the reversal; its balanceAfter = 48.
    const list = screen.getByRole("list");
    const firstRow = within(list).getAllByRole("listitem")[0]!;
    expect(firstRow).toHaveTextContent("คงเหลือ 48");
  });

  it("renders an empty state when the item has no movements", () => {
    render(<MaterialLogView entries={[]} unit="ท่อน" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/ยังไม่มีความเคลื่อนไหว/)).toBeInTheDocument();
  });

  // Spec 324 U6 — a receipt with a pending correction flag shows ⚠ รอแก้ไข.
  it("marks a flagged receipt entry with ⚠ รอแก้ไข", () => {
    render(
      <MaterialLogView
        entries={buildMaterialLog(sources)}
        unit="ท่อน"
        flaggedReceiptIds={["r1"]}
      />,
    );
    expect(screen.getByText(RECEIPT_CORRECTION_PENDING_LABEL)).toBeInTheDocument();
  });

  it("shows no ⚠ รอแก้ไข badge when the receipt is not flagged", () => {
    render(<MaterialLogView entries={buildMaterialLog(sources)} unit="ท่อน" />);
    expect(screen.queryByText(RECEIPT_CORRECTION_PENDING_LABEL)).toBeNull();
  });
});
