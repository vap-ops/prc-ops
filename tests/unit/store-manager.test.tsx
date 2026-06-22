// Spec 177 U2 — the /store surface: pick a project, see its on-hand (qty + value
// + derived moving-avg cost), and record a stock-in (รับเข้า) at cost. Mocked
// action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockRefresh, mockPush } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({ recordStockIn: mockRecord }));

import { StoreManager, type StockRow } from "@/components/features/store/store-manager";

const projects = [
  { id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" },
  { id: "p2", code: "PRC-2026-002", name: "อาคารบี" },
];
const catalogItems = [
  {
    id: "ci1",
    category: "electrical" as const,
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
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
  mockRecord.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
});

function renderManager(opts: { selectedProjectId?: string | null; onHand?: StockRow[] }) {
  render(
    <StoreManager
      projects={projects}
      selectedProjectId={opts.selectedProjectId === undefined ? "p1" : opts.selectedProjectId}
      onHand={opts.onHand ?? onHand}
      catalogItems={catalogItems}
      suppliers={suppliers}
    />,
  );
}

describe("StoreManager (spec 177 U2)", () => {
  it("shows on-hand rows with qty, value and derived moving-avg cost", () => {
    renderManager({});
    expect(screen.getByText("สายไฟ NYY")).toBeInTheDocument();
    // qty 20 ม้วน
    expect(screen.getByText(/20\s*ม้วน/)).toBeInTheDocument();
    // moving-avg cost = 600 / 20 = 30.00
    expect(screen.getByText(/30\.00/)).toBeInTheDocument();
  });

  it("shows an empty state when the project has no stock", () => {
    renderManager({ onHand: [] });
    expect(screen.getByText("ยังไม่มีสต๊อกในสโตร์")).toBeInTheDocument();
  });

  it("switching the project selector navigates to that project's store", () => {
    renderManager({});
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    expect(mockPush).toHaveBeenCalledWith("/store?project=p2");
  });

  it("disables the record submit until item, qty and unit cost are set", () => {
    renderManager({});
    fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
    const submit = screen.getByRole("button", { name: "บันทึก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "25" } });
    expect(submit).toBeEnabled();
  });

  it("records a stock-in with the chosen item, qty, unit cost, supplier and note", async () => {
    renderManager({});
    fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(/ผู้ขาย/), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "งวดแรก" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockRecord).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        qty: 10,
        unitCost: 25,
        supplierId: "s1",
        note: "งวดแรก",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("the record control is hidden until a project is selected", () => {
    renderManager({ selectedProjectId: null, onHand: [] });
    expect(screen.queryByRole("button", { name: /รับเข้าสต๊อก/ })).toBeNull();
  });
});
