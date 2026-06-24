// Writing failing test first.
//
// Spec 197 U2 — ตรวจนับ unified into คลัง. The standalone /stock-count route is
// retired and its focused count-list (StoreCountManager) relocated behind a
// ตรวจนับทั้งคลัง action on the per-project คลัง page. The component gains:
//   • hidePicker — the project comes from the route, so the picker disappears
//     (the picker that used to push /stock-count?project=… is gone),
//   • collapsible — render a ตรวจนับทั้งคลัง toggle; the full item list shows only
//     after the operator opens it (a deliberate full-stocktake mode, distinct
//     from the per-row spot count already on the คลัง surface).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh, mockPush } = vi.hoisted(() => ({ mockRefresh: vi.fn(), mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({ recordStockCount: vi.fn() }));

import {
  StoreCountManager,
  type CountStockRow,
} from "@/components/features/store/store-count-manager";
import { FULL_STOCKTAKE_LABEL } from "@/lib/i18n/labels";

const projects = [{ id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" }];
const onHand: CountStockRow[] = [
  { catalogItemId: "ci1", baseItem: "สายไฟ NYY", specAttrs: "3x6", unit: "ม้วน", qtyOnHand: 20 },
];

beforeEach(() => {
  mockRefresh.mockReset();
  mockPush.mockReset();
});

describe("spec 197 U2 — ตรวจนับทั้งคลัง relocated into คลัง", () => {
  it("FULL_STOCKTAKE_LABEL is the ตรวจนับทั้งคลัง term", () => {
    expect(FULL_STOCKTAKE_LABEL).toBe("ตรวจนับทั้งคลัง");
  });

  it("hidePicker suppresses the project picker (the route supplies the project)", () => {
    render(
      <StoreCountManager projects={projects} selectedProjectId="p1" onHand={onHand} hidePicker />,
    );
    expect(screen.queryByLabelText("โครงการ")).toBeNull();
  });

  it("collapsible hides the full count list behind a ตรวจนับทั้งคลัง toggle", () => {
    render(
      <StoreCountManager
        projects={projects}
        selectedProjectId="p1"
        onHand={onHand}
        hidePicker
        collapsible
      />,
    );
    // The full list is hidden until the operator opens the stocktake.
    expect(screen.queryByText("สายไฟ NYY")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: FULL_STOCKTAKE_LABEL }));
    // Now the items + their per-row ตรวจนับ controls are visible.
    expect(screen.getByText("สายไฟ NYY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตรวจนับ" })).toBeInTheDocument();
  });
});
