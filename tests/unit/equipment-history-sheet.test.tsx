// Writing failing test first.
//
// Spec 381 U2 — the ประวัติ sheet: a per-item timeline read through the U1
// DEFINER RPC, opened from the row's control cluster.
//
// What these pin, beyond "it renders":
//   - the history is fetched ON OPEN, not on page load. There are up to 64 rows
//     on /equipment and nobody opens 64 timelines; loading them eagerly would be
//     64 RPC calls for a sheet the operator may never tap.
//   - a refusal is SHOWN. The RPC raises 42501 for anyone outside the /equipment
//     audience, and a sheet that silently renders "no history" for a permission
//     failure is the honest-copy defect (#823/#826/#827) in a new place.
//   - an EMPTY history says so. A fresh item genuinely has no events, and a blank
//     sheet is indistinguishable from a failed load.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoad } = vi.hoisted(() => ({ mockLoad: vi.fn() }));

vi.mock("@/app/equipment/history-actions", () => ({ loadEquipmentHistory: mockLoad }));

import { EquipmentHistorySheet } from "@/components/features/equipment/equipment-history-sheet";

const ENTRIES = [
  {
    occurredAt: "2026-07-30T09:00:00+00:00",
    kind: "item_updated",
    actorId: null,
    detail: { changes: { name: { from: "ก", to: "ข" } } },
  },
  {
    occurredAt: "2026-07-29T02:30:00+00:00",
    kind: "movement_deployed",
    actorId: null,
    detail: { note: "ส่งไปไซต์บางนา" },
  },
];

beforeEach(() => {
  mockLoad.mockReset().mockResolvedValue({ ok: true, entries: ENTRIES });
});

describe("EquipmentHistorySheet (spec 381 U2)", () => {
  it("does not fetch until the sheet is opened", () => {
    render(<EquipmentHistorySheet itemId="e1" itemName="สว่าน" />);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("fetches on open and lists the events with Thai labels", async () => {
    render(<EquipmentHistorySheet itemId="e1" itemName="สว่าน" />);
    fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));

    await waitFor(() => expect(mockLoad).toHaveBeenCalledWith("e1"));
    await waitFor(() => expect(screen.getByText("แก้ไขข้อมูล")).toBeInTheDocument());
    expect(screen.getByText("ส่งไปโครงการ")).toBeInTheDocument();
    // The detail line under each event.
    expect(screen.getByText("ชื่ออุปกรณ์")).toBeInTheDocument();
    expect(screen.getByText("ส่งไปไซต์บางนา")).toBeInTheDocument();
  });

  it("says so when there is no history yet", async () => {
    mockLoad.mockResolvedValue({ ok: true, entries: [] });
    render(<EquipmentHistorySheet itemId="e1" itemName="สว่าน" />);
    fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));

    await waitFor(() => expect(screen.getByText(/ยังไม่มีประวัติ/)).toBeInTheDocument());
  });

  it("shows a refusal instead of an empty timeline", async () => {
    mockLoad.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์ดูประวัติอุปกรณ์" });
    render(<EquipmentHistorySheet itemId="e1" itemName="สว่าน" />);
    fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("ไม่มีสิทธิ์");
    expect(screen.queryByText(/ยังไม่มีประวัติ/)).not.toBeInTheDocument();
  });
});
