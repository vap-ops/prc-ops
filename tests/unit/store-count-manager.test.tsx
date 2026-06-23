// Spec 178 B2 — site_admin stock-count surface. site_admin holds the store but
// can't reach /store (BACK_OFFICE-gated); record_stock_count is SITE_STAFF-gated,
// so they need their own count-only surface: pick a project → on-hand → ตรวจนับ.
// Focused (no รับเข้า/เบิก/reversal). Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCount, mockRefresh, mockPush } = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({ recordStockCount: mockCount }));

import {
  StoreCountManager,
  type CountStockRow,
} from "@/components/features/store/store-count-manager";

const projects = [
  { id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" },
  { id: "p2", code: "PRC-2026-002", name: "อาคารบี" },
];
const onHand: CountStockRow[] = [
  { catalogItemId: "ci1", baseItem: "สายไฟ NYY", specAttrs: "3x6", unit: "ม้วน", qtyOnHand: 20 },
];

beforeEach(() => {
  mockCount.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
});

function renderCount(opts: { selectedProjectId?: string | null; onHand?: CountStockRow[] }) {
  render(
    <StoreCountManager
      projects={projects}
      selectedProjectId={opts.selectedProjectId === undefined ? "p1" : opts.selectedProjectId}
      onHand={opts.onHand ?? onHand}
    />,
  );
}

describe("StoreCountManager (spec 178 B2)", () => {
  it("navigates when a project is picked", () => {
    renderCount({ selectedProjectId: null });
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    expect(mockPush).toHaveBeenCalledWith("/stock-count?project=p2");
  });

  it("shows on-hand rows with a ตรวจนับ control when a project is selected", () => {
    renderCount({});
    expect(screen.getByText("สายไฟ NYY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตรวจนับ" })).toBeInTheDocument();
  });

  it("shows an empty state when the store has no stock", () => {
    renderCount({ onHand: [] });
    expect(screen.getByText(/ยังไม่มีสต๊อก/)).toBeInTheDocument();
  });

  it("records a count with the live variance and refreshes", async () => {
    renderCount({});
    fireEvent.click(screen.getByRole("button", { name: "ตรวจนับ" }));
    fireEvent.change(screen.getByLabelText("จำนวนที่นับได้"), { target: { value: "18" } });
    expect(screen.getByText(/ส่วนต่าง\s*-2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการนับ" }));

    await waitFor(() =>
      expect(mockCount).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        countedQty: 18,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
