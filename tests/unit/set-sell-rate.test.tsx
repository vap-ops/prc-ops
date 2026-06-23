// Spec 178 U5 — the per-item sell-rate setter (super_admin only, on /catalog).
// The control shows the current rate (or "ตั้งราคาขาย" when unset) and writes via
// the setItemSellRate action. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockRefresh } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/catalog/actions", () => ({
  setItemSellRate: mockSet,
}));

import { SetSellRate } from "@/components/features/catalog/set-sell-rate";

describe("SetSellRate", () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockRefresh.mockReset();
    mockSet.mockResolvedValue({ ok: true });
  });

  it("prompts to set a rate when none exists", () => {
    render(<SetSellRate itemId="ci1" currentRate={null} />);
    expect(screen.getByText("ตั้งราคาขาย")).toBeInTheDocument();
  });

  it("shows the current rate when set", () => {
    render(<SetSellRate itemId="ci1" currentRate={50} />);
    expect(screen.getByText(/฿50/)).toBeInTheDocument();
  });

  it("submits the new rate via setItemSellRate and refreshes", async () => {
    render(<SetSellRate itemId="ci1" currentRate={50} />);
    fireEvent.click(screen.getByText(/฿50/));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ id: "ci1", rate: 75 }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
