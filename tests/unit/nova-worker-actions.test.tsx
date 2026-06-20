// Spec 161 U12 — NovaWorkerActions: the operator's per-worker actions. Actions are
// mocked — the contract is the right action + args + refresh per control, the themed
// confirm on the destructive confiscation, and inline error.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NovaWorkerActions } from "@/components/features/nova/nova-worker-actions";
import {
  awardSaversBonusAction,
  confiscateCoinsAction,
  redeemShopItemAction,
} from "@/lib/nova/worker-actions";

vi.mock("@/lib/nova/worker-actions", () => ({
  awardSaversBonusAction: vi.fn(),
  confiscateCoinsAction: vi.fn(),
  redeemShopItemAction: vi.fn(),
}));
vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { refreshMock } from "../helpers/router-refresh";

const WORKER = "11111111-1111-1111-1111-111111111111";
const ITEMS = [{ id: "22222222-2222-2222-2222-222222222222", name: "หมวก", price_coins: 100 }];

beforeEach(() => {
  vi.mocked(awardSaversBonusAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(confiscateCoinsAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(redeemShopItemAction).mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockReset();
});

describe("NovaWorkerActions", () => {
  it("awards the saver bonus and refreshes", async () => {
    render(<NovaWorkerActions workerId={WORKER} shopItems={ITEMS} />);
    await userEvent.click(screen.getByRole("button", { name: "มอบโบนัสออม" }));
    await waitFor(() => expect(awardSaversBonusAction).toHaveBeenCalledWith(WORKER));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("redeems the chosen item", async () => {
    render(<NovaWorkerActions workerId={WORKER} shopItems={ITEMS} />);
    await userEvent.selectOptions(screen.getByLabelText("เลือกสินค้า"), ITEMS[0]!.id);
    await userEvent.click(screen.getByRole("button", { name: "แลกของรางวัล" }));
    await waitFor(() => expect(redeemShopItemAction).toHaveBeenCalledWith(WORKER, ITEMS[0]!.id));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("confiscates with the chosen reason after the themed confirm", async () => {
    render(<NovaWorkerActions workerId={WORKER} shopItems={ITEMS} />);
    await userEvent.selectOptions(screen.getByLabelText("เหตุผลริบเหรียญ"), "theft");
    await userEvent.click(screen.getByRole("button", { name: "ริบเหรียญ" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยันริบ" }));
    await waitFor(() => expect(confiscateCoinsAction).toHaveBeenCalledWith(WORKER, "theft", ""));
  });

  it("surfaces a saver-bonus error inline", async () => {
    vi.mocked(awardSaversBonusAction).mockResolvedValue({ ok: false, error: "ไม่มียอดให้โบนัส" });
    render(<NovaWorkerActions workerId={WORKER} shopItems={ITEMS} />);
    await userEvent.click(screen.getByRole("button", { name: "มอบโบนัสออม" }));
    await waitFor(() => expect(screen.getByText("ไม่มียอดให้โบนัส")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
