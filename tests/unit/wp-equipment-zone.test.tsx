// Writing failing test first.
//
// Spec 202 U2 — the WP อุปกรณ์ tab: a rate-free check-out/check-in surface
// mirroring the ทีมงาน (labor) tab. The field picks an item + date to check it
// out, and checks an open span back in. NO money on screen (daily_rate_snapshot
// is admin-only). Mocked actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckOut, mockCheckIn, mockRefresh } = vi.hoisted(() => ({
  mockCheckOut: vi.fn(),
  mockCheckIn: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/equipment/usage-actions", () => ({
  checkOutEquipment: mockCheckOut,
  checkInEquipment: mockCheckIn,
}));

import { WpEquipmentZone } from "@/components/features/equipment/wp-equipment-zone";

const ITEMS = [
  { id: "e1", name: "เครื่องปั่นไฟ 5kVA", assetTag: "GEN-001" },
  { id: "e2", name: "สว่านโรตารี่", assetTag: "DR-2" },
];

function renderZone(over?: {
  open?: { id: string; itemId: string; checkedOutOn: string; checkedInOn: string | null }[];
  history?: { id: string; itemId: string; checkedOutOn: string; checkedInOn: string | null }[];
  locked?: boolean;
}) {
  render(
    <WpEquipmentZone
      workPackageId="wp1"
      revalidate="/projects/p1/work-packages/wp1"
      items={ITEMS}
      itemNames={{ e1: ITEMS[0]!.name, e2: ITEMS[1]!.name }}
      open={over?.open ?? []}
      history={over?.history ?? []}
      locked={over?.locked ?? false}
      defaultDate="2026-07-10"
    />,
  );
}

beforeEach(() => {
  mockCheckOut.mockReset().mockResolvedValue({ ok: true });
  mockCheckIn.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("WpEquipmentZone", () => {
  it("checks an item out with the chosen date", async () => {
    renderZone();
    fireEvent.change(screen.getByLabelText("เลือกอุปกรณ์"), { target: { value: "e2" } });
    fireEvent.click(screen.getByRole("button", { name: "เช็คเอาท์" }));
    await waitFor(() =>
      expect(mockCheckOut).toHaveBeenCalledWith(
        expect.objectContaining({ workPackageId: "wp1", itemId: "e2", checkoutDate: "2026-07-10" }),
      ),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("omits an already-checked-out item from the picker", () => {
    renderZone({
      open: [{ id: "u1", itemId: "e1", checkedOutOn: "2026-07-08", checkedInOn: null }],
    });
    // e1 is out → not an option; e2 is still selectable. (Option text appends the
    // asset tag, so match by substring.)
    expect(screen.queryByRole("option", { name: /เครื่องปั่นไฟ 5kVA/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /สว่านโรตารี่/ })).toBeInTheDocument();
  });

  it("checks an open span back in with the chosen date", async () => {
    renderZone({
      open: [{ id: "u1", itemId: "e1", checkedOutOn: "2026-07-08", checkedInOn: null }],
    });
    fireEvent.click(screen.getByRole("button", { name: "คืน" }));
    fireEvent.change(screen.getByLabelText("วันที่คืน"), { target: { value: "2026-07-11" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() =>
      expect(mockCheckIn).toHaveBeenCalledWith(
        expect.objectContaining({ logId: "u1", checkinDate: "2026-07-11" }),
      ),
    );
  });

  it("when locked: no check-out form and no คืน control, but history still shows", () => {
    renderZone({
      locked: true,
      open: [{ id: "u1", itemId: "e1", checkedOutOn: "2026-07-08", checkedInOn: null }],
      history: [{ id: "h1", itemId: "e2", checkedOutOn: "2026-06-01", checkedInOn: "2026-06-03" }],
    });
    expect(screen.queryByRole("button", { name: "เช็คเอาท์" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "คืน" })).not.toBeInTheDocument();
    // history row's item name renders (read-only)
    expect(screen.getByText(/สว่านโรตารี่/)).toBeInTheDocument();
  });
});
