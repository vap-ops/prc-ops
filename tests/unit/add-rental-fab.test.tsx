// Writing failing test first.
//
// Spec 323 U1c — AddRentalFab: the floating pill (same corner as the /expenses
// AddExpenseFab) that opens the record-a-deal form in a bottom sheet, so the rental
// pages read as a read-only list instead of a list-with-a-form-stapled-on. The sheet
// closes itself on a clean save via the form's onDone. Mirrors add-expense-fab.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateBatch, mockRefresh } = vi.hoisted(() => ({
  mockCreateBatch: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  createRentalBatch: mockCreateBatch,
}));

import { AddRentalFab } from "@/components/features/equipment/add-rental-fab";

const suppliers = [{ id: "o1", name: "บ.เครนไทย" }];
const projects = [{ id: "p1", name: "โครงการ A" }];

describe("AddRentalFab", () => {
  beforeEach(() => {
    mockCreateBatch.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("hides the form until the FAB is pressed", () => {
    render(<AddRentalFab suppliers={suppliers} projects={projects} defaultDate="2026-07-05" />);
    expect(screen.queryByLabelText("เช่าจาก")).not.toBeInTheDocument();
  });

  it("opens the record-deal sheet from the FAB", () => {
    render(<AddRentalFab suppliers={suppliers} projects={projects} defaultDate="2026-07-05" />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    expect(screen.getByLabelText("เช่าจาก")).toBeInTheDocument();
  });

  it("records a deal from the sheet, then closes it", async () => {
    render(<AddRentalFab suppliers={suppliers} projects={projects} defaultDate="2026-07-05" />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    fireEvent.change(screen.getByLabelText("เช่าจาก"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    // the submit button inside the sheet carries the same label as the FAB — scope
    // by grabbing the one inside the open dialog.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() => expect(mockCreateBatch).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
