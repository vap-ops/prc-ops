// Writing failing test first.
//
// Spec 202 U1 — the per-item equipment daily-rate setter (back-office money
// audience only, on /equipment). The control shows the current rate (or
// "ตั้งค่าเช่า/วัน" when unset) and writes via the setEquipmentDailyRate action.
// MONEY: this never renders on the site_admin field view (the page omits the
// dailyRates prop for them). Mirrors the catalog SetSellRate control. Mocked
// action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockRefresh } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/actions", () => ({
  setEquipmentDailyRate: mockSet,
}));

import { SetDailyRate } from "@/components/features/equipment/set-daily-rate";

describe("SetDailyRate", () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockRefresh.mockReset();
    mockSet.mockResolvedValue({ ok: true });
  });

  it("prompts to set a rate when none exists", () => {
    render(<SetDailyRate itemId="e1" currentRate={null} />);
    expect(screen.getByText("ตั้งค่าเช่า/วัน")).toBeInTheDocument();
  });

  it("shows the current rate per day when set", () => {
    render(<SetDailyRate itemId="e1" currentRate={800} />);
    expect(screen.getByText(/฿800/)).toBeInTheDocument();
  });

  it("submits the new rate via setEquipmentDailyRate and refreshes", async () => {
    render(<SetDailyRate itemId="e1" currentRate={800} />);
    fireEvent.click(screen.getByText(/฿800/));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ id: "e1", rate: 1200 }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("rejects a negative rate client-side before calling the action", async () => {
    render(<SetDailyRate itemId="e1" currentRate={null} />);
    fireEvent.click(screen.getByText("ตั้งค่าเช่า/วัน"));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockSet).not.toHaveBeenCalled();
  });
});
