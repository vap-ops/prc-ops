// Writing failing test first.
//
// Spec 198 U1 — multi-line รับเข้า (bulk stock check-in). The รับเข้าสต๊อก sheet
// stops being a single-item form and becomes a multi-row grid (one draft row to
// start, + เพิ่มรายการ to add more, remove per row), recorded in ONE submit via
// recordStockInBulk. Mirrors the supply-plan grid / delivery checklist so a
// real delivery is checked in as a list, not one item at a time.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBulk, mockRefresh, mockPush } = vi.hoisted(() => ({
  mockBulk: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({
  recordStockIn: vi.fn(),
  recordStockInBulk: mockBulk,
  issueStock: vi.fn(),
  recordStockCount: vi.fn(),
  reverseStockReceipt: vi.fn(),
  reverseStockIssue: vi.fn(),
  confirmStockIssueOnBehalf: vi.fn(),
}));

import { StoreManager, type StockRow } from "@/components/features/store/store-manager";

const catalogItems = [
  {
    id: "ci1",
    category: "electrical" as const,
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
  },
  {
    id: "ci2",
    category: "electrical" as const,
    baseItem: "ท่อ PVC",
    specAttrs: null,
    unit: "เส้น",
  },
];
const suppliers = [{ id: "s1", name: "ร้านวัสดุดี" }];
const onHand: StockRow[] = [
  {
    catalogItemId: "ci1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    qtyOnHand: 20,
    totalValue: 600,
  },
];

beforeEach(() => {
  mockBulk.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
});

function open() {
  render(
    <StoreManager
      projects={[{ id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" }]}
      selectedProjectId="p1"
      hidePicker
      onHand={onHand}
      catalogItems={catalogItems}
      suppliers={suppliers}
      canIssue={false}
      receipts={[]}
      counts={[]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
}

describe("spec 198 U1 — multi-line รับเข้า grid", () => {
  it("opens a grid with one draft row, an add-row control, and a disabled submit", () => {
    open();
    expect(screen.getAllByLabelText("วัสดุ")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /เพิ่มรายการ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกทั้งหมด" })).toBeDisabled();
  });

  it("enables submit once a row has item + qty + cost", () => {
    open();
    fireEvent.change(screen.getAllByLabelText("วัสดุ")[0]!, { target: { value: "ci1" } });
    fireEvent.change(screen.getAllByLabelText("จำนวน")[0]!, { target: { value: "10" } });
    fireEvent.change(screen.getAllByLabelText(/ราคาต้นทุน/)[0]!, { target: { value: "25" } });
    expect(screen.getByRole("button", { name: "บันทึกทั้งหมด" })).toBeEnabled();
  });

  it("records every complete row in one bulk call", async () => {
    open();
    // row 0
    fireEvent.change(screen.getAllByLabelText("วัสดุ")[0]!, { target: { value: "ci1" } });
    fireEvent.change(screen.getAllByLabelText("จำนวน")[0]!, { target: { value: "10" } });
    fireEvent.change(screen.getAllByLabelText(/ราคาต้นทุน/)[0]!, { target: { value: "25" } });
    // add + fill row 1
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการ/ }));
    fireEvent.change(screen.getAllByLabelText("วัสดุ")[1]!, { target: { value: "ci2" } });
    fireEvent.change(screen.getAllByLabelText("จำนวน")[1]!, { target: { value: "5" } });
    fireEvent.change(screen.getAllByLabelText(/ราคาต้นทุน/)[1]!, { target: { value: "40" } });

    fireEvent.click(screen.getByRole("button", { name: "บันทึกทั้งหมด" }));

    await waitFor(() =>
      expect(mockBulk).toHaveBeenCalledWith({
        projectId: "p1",
        lines: [
          { catalogItemId: "ci1", qty: 10, unitCost: 25, supplierId: "", note: "" },
          { catalogItemId: "ci2", qty: 5, unitCost: 40, supplierId: "", note: "" },
        ],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("drops incomplete rows from the submit", async () => {
    open();
    fireEvent.change(screen.getAllByLabelText("วัสดุ")[0]!, { target: { value: "ci1" } });
    fireEvent.change(screen.getAllByLabelText("จำนวน")[0]!, { target: { value: "10" } });
    fireEvent.change(screen.getAllByLabelText(/ราคาต้นทุน/)[0]!, { target: { value: "25" } });
    // add an empty row; it must be ignored on submit
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการ/ }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกทั้งหมด" }));

    await waitFor(() =>
      expect(mockBulk).toHaveBeenCalledWith({
        projectId: "p1",
        lines: [{ catalogItemId: "ci1", qty: 10, unitCost: 25, supplierId: "", note: "" }],
      }),
    );
  });
});
