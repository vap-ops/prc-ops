// Spec 367 §10.4 — the per-item acquisition control (money audience only).
//
// It mirrors SetDailyRate deliberately: same row cluster, same 44px floor, same
// resync-on-open contract (a sheet seeded at mount silently reverts another
// actor's change after a router.refresh — spec 385 U4's review find).
//
// The one thing this control does that SetDailyRate does not is CLEAR: both
// fields are blankable, and blank means null means cleared. The trigger label
// must therefore be honest about the empty state rather than implying a value.
//
// ⚠️ The field queries are EXACT strings, not /regex/: the sheet's own title is
// "บันทึกราคาทุน" and labels the dialog, so a loose /ราคาทุน/ matches the dialog
// as well as the input and getByLabelText throws on the ambiguity.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockRefresh } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/equipment/actions", () => ({ setEquipmentAcquisition: mockSet }));

import { SetAcquisition } from "@/components/features/equipment/set-acquisition";

const ITEM = "11111111-2222-4333-8444-555555555555";
const COST_FIELD = "ราคาทุน (บาท)";
const DATE_FIELD = "วันที่ได้มา";

beforeEach(() => {
  mockSet.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("SetAcquisition", () => {
  it("says the cost is unrecorded rather than showing a zero", () => {
    render(<SetAcquisition itemId={ITEM} currentCost={null} currentAcquiredAt={null} />);

    const trigger = screen.getByRole("button", { name: /ราคาทุน/ });
    expect(trigger.textContent).not.toContain("฿0");
  });

  // Two money controls sit in the same row cluster (this and SetDailyRate), so a
  // bare "฿12,500" beside "฿300/วัน" is two figures with nothing saying which is
  // which — invisible grouping for a screen reader. The word stays in both states.
  it("names the figure on the trigger, not just the amount", () => {
    render(<SetAcquisition itemId={ITEM} currentCost={12500} currentAcquiredAt="2025-03-04" />);

    expect(screen.getByRole("button", { name: /ราคาทุน/ })).toHaveTextContent("12,500");
  });

  it("sends both fields as raw text so the action owns the parsing", async () => {
    render(<SetAcquisition itemId={ITEM} currentCost={null} currentAcquiredAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /ราคาทุน/ }));

    fireEvent.change(screen.getByLabelText(COST_FIELD), { target: { value: "12500.50" } });
    fireEvent.change(screen.getByLabelText(DATE_FIELD), { target: { value: "2025-03-04" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({
        id: ITEM,
        cost: "12500.50",
        acquiredAt: "2025-03-04",
      }),
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("allows clearing both fields — blank is a value here, not a no-op", async () => {
    render(<SetAcquisition itemId={ITEM} currentCost={999} currentAcquiredAt="2025-01-01" />);
    fireEvent.click(screen.getByRole("button", { name: /ราคาทุน/ }));

    fireEvent.change(screen.getByLabelText(COST_FIELD), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(DATE_FIELD), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({ id: ITEM, cost: "", acquiredAt: "" }),
    );
  });

  it("resyncs from the CURRENT values on open, not from mount", () => {
    const { rerender } = render(
      <SetAcquisition itemId={ITEM} currentCost={100} currentAcquiredAt="2025-01-01" />,
    );
    // Another actor's change arrives via router.refresh → new props, same mount.
    rerender(<SetAcquisition itemId={ITEM} currentCost={250} currentAcquiredAt="2025-02-02" />);
    fireEvent.click(screen.getByRole("button", { name: /ราคาทุน/ }));

    expect(screen.getByLabelText<HTMLInputElement>(COST_FIELD).value).toBe("250");
    expect(screen.getByLabelText<HTMLInputElement>(DATE_FIELD).value).toBe("2025-02-02");
  });

  it("surfaces the action's refusal and keeps the sheet open to fix it", async () => {
    mockSet.mockResolvedValue({ ok: false, error: "วันที่ได้มาต้องไม่เป็นวันในอนาคต" });
    render(<SetAcquisition itemId={ITEM} currentCost={null} currentAcquiredAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /ราคาทุน/ }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/อนาคต/));
    expect(screen.getByLabelText(COST_FIELD)).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
