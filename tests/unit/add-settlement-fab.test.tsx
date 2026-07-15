// Writing failing test first.
//
// Spec 323 U1c — AddSettlementFab: the second floating pill on /equipment/rentals,
// stacked above the record-deal FAB. It opens the record-a-settlement form in a
// bottom sheet; the sheet closes itself on a clean save via the form's onDone.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockRefresh } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  recordRentalSettlement: mockRecord,
}));

import { AddSettlementFab } from "@/components/features/equipment/add-settlement-fab";

const agreements = [{ id: "b1", label: "บ.เครนไทย · ฿90,000.00/เดือน" }];

describe("AddSettlementFab", () => {
  beforeEach(() => {
    mockRecord.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("hides the form until the FAB is pressed", () => {
    render(<AddSettlementFab agreements={agreements} defaultDate="2026-07-08" />);
    expect(screen.queryByLabelText("สัญญาเช่า")).not.toBeInTheDocument();
  });

  it("opens the record-settlement sheet from the FAB", () => {
    render(<AddSettlementFab agreements={agreements} defaultDate="2026-07-08" />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการชำระ" }));
    expect(screen.getByLabelText("สัญญาเช่า")).toBeInTheDocument();
  });

  it("records a settlement from the sheet, then closes it", async () => {
    render(<AddSettlementFab agreements={agreements} defaultDate="2026-07-08" />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการชำระ" }));
    fireEvent.change(screen.getByLabelText("สัญญาเช่า"), { target: { value: "b1" } });
    fireEvent.change(screen.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-1" } });
    fireEvent.change(screen.getByLabelText("วันที่ใบแจ้งหนี้"), {
      target: { value: "2026-07-08" },
    });
    fireEvent.change(screen.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกการชำระ" }));
    await waitFor(() => expect(mockRecord).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
