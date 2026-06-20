// Spec 161 U7 — NovaDialsForm: the operator calibrates the Nova economic dials
// (nova_dials) + the per-level sell rates (sell_rate_table). The setter actions
// are mocked; the contract is: each row saves its CURRENT value via the right
// action (with the edited field applied), refreshes on success, shows inline error.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NovaDialsForm } from "@/components/features/nova/nova-dials-form";
import { setNovaDial, setSellRate } from "@/lib/nova/dials-actions";

vi.mock("@/lib/nova/dials-actions", () => ({
  setNovaDial: vi.fn(),
  setSellRate: vi.fn(),
}));
vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { refreshMock } from "../helpers/router-refresh";

const DIALS = [
  { key: "coin_multiplier", value: 1 },
  { key: "ht_cut_pct", value: 0.15 },
];
const RATES = [
  { level: "senior" as const, cost_band: 650, internal_sell: 800, external_sell: 950 },
];

beforeEach(() => {
  vi.mocked(setNovaDial).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(setSellRate).mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockReset();
});

describe("NovaDialsForm", () => {
  it("renders the seeded dial values for editing", () => {
    render(<NovaDialsForm dials={DIALS} rates={RATES} />);
    expect(screen.getByLabelText("ตัวคูณเหรียญ")).toHaveValue(1);
    expect(screen.getByLabelText("ส่วนแบ่ง HT")).toHaveValue(0.15);
  });

  it("saves an edited dial via setNovaDial(key, value) and refreshes", async () => {
    render(<NovaDialsForm dials={DIALS} rates={RATES} />);
    const input = screen.getByLabelText("ตัวคูณเหรียญ");
    await userEvent.clear(input);
    await userEvent.type(input, "1.8");
    await userEvent.click(screen.getByRole("button", { name: "บันทึก ตัวคูณเหรียญ" }));

    await waitFor(() => expect(setNovaDial).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setNovaDial).mock.calls[0]).toEqual(["coin_multiplier", 1.8]);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("saves an edited sell rate via setSellRate(level, cost, internal, external)", async () => {
    render(<NovaDialsForm dials={DIALS} rates={RATES} />);
    const row = screen.getByTestId("rate-senior");
    const internal = within(row).getByLabelText("ราคาขายภายใน");
    await userEvent.clear(internal);
    await userEvent.type(internal, "820");
    await userEvent.click(within(row).getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(setSellRate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setSellRate).mock.calls[0]).toEqual(["senior", 650, 820, 950]);
  });

  it("surfaces a setter error inline", async () => {
    vi.mocked(setNovaDial).mockResolvedValue({ ok: false, error: "บันทึกไม่สำเร็จ" });
    render(<NovaDialsForm dials={DIALS} rates={RATES} />);
    await userEvent.click(screen.getByRole("button", { name: "บันทึก ส่วนแบ่ง HT" }));

    await waitFor(() => expect(screen.getByText("บันทึกไม่สำเร็จ")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
