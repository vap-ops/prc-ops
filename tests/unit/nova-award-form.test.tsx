// Spec 162 U1 — NovaAwardForm: the operator awards Nova coins to a worker.
// The award action is mocked; the form's contract is the submit gate (worker +
// positive amount + reason), the action args, reset-on-success, and inline error.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NovaAwardForm } from "@/components/features/nova/nova-award-form";
import { awardCoins } from "@/lib/nova/actions";

vi.mock("@/lib/nova/actions", () => ({ awardCoins: vi.fn() }));
vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { refreshMock } from "../helpers/router-refresh";

const WORKERS = [
  { id: "w1", name: "ช่างหนึ่ง" },
  { id: "w2", name: "ช่างสอง" },
];

beforeEach(() => {
  vi.mocked(awardCoins).mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockReset();
});

describe("NovaAwardForm", () => {
  it("disables the award until a worker, a positive amount, and a reason are present", async () => {
    render(<NovaAwardForm workers={WORKERS} />);
    const button = screen.getByRole("button", { name: "มอบเหรียญ" });
    expect(button).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("ทีมงาน"), "w1");
    await userEvent.type(screen.getByLabelText("จำนวนเหรียญ"), "10");
    await userEvent.type(screen.getByLabelText("เหตุผล"), "มาตรงเวลา");
    expect(button).toBeEnabled();
  });

  it("awards the chosen worker/source/amount/reason and resets on success", async () => {
    render(<NovaAwardForm workers={WORKERS} />);
    await userEvent.selectOptions(screen.getByLabelText("ทีมงาน"), "w2");
    await userEvent.type(screen.getByLabelText("จำนวนเหรียญ"), "25");
    const reason = screen.getByLabelText("เหตุผล");
    await userEvent.type(reason, "งานไม่มีตำหนิ");
    await userEvent.click(screen.getByRole("button", { name: "มอบเหรียญ" }));

    await waitFor(() => expect(awardCoins).toHaveBeenCalledTimes(1));
    expect(vi.mocked(awardCoins).mock.calls[0]?.[0]).toEqual({
      workerId: "w2",
      source: "behavior_bonus",
      amount: 25,
      reason: "งานไม่มีตำหนิ",
    });
    // Resets + refreshes the page so the new balance/ledger shows.
    await waitFor(() => expect(reason).toHaveValue(""));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces an action error inline", async () => {
    vi.mocked(awardCoins).mockResolvedValue({ ok: false, error: "มอบเหรียญไม่สำเร็จ" });
    render(<NovaAwardForm workers={WORKERS} />);
    await userEvent.selectOptions(screen.getByLabelText("ทีมงาน"), "w1");
    await userEvent.type(screen.getByLabelText("จำนวนเหรียญ"), "5");
    await userEvent.type(screen.getByLabelText("เหตุผล"), "ทดสอบ");
    await userEvent.click(screen.getByRole("button", { name: "มอบเหรียญ" }));

    await waitFor(() => expect(screen.getByText("มอบเหรียญไม่สำเร็จ")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
