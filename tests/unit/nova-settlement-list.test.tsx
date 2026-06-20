// Spec 161 U8 — NovaSettlementList: the operator runs the close-out lifecycle.
// A CLOSED, unsettled project offers "settle"; a SETTLED, undistributed project
// offers "distribute" (and shows the pool); an OPEN project offers neither. The
// actions are mocked — the contract is the right action per state + refresh + error.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NovaSettlementList } from "@/components/features/nova/nova-settlement-list";
import { settleProjectAction, distributeProjectCoinsAction } from "@/lib/nova/settlement-actions";

vi.mock("@/lib/nova/settlement-actions", () => ({
  settleProjectAction: vi.fn(),
  distributeProjectCoinsAction: vi.fn(),
}));
vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { refreshMock } from "../helpers/router-refresh";

const PROJECTS = [
  {
    id: "aaa",
    code: "P-A",
    name: "อาคารเอ",
    status: "completed",
    settlement: null,
    distribution: null,
  },
  {
    id: "bbb",
    code: "P-B",
    name: "อาคารบี",
    status: "completed",
    settlement: {
      coinPool: 16400,
      bankedProfitTotal: 8200,
      wpBankedCount: 2,
      wpSkippedNullBudgetCount: 1,
      equipmentCosted: true,
    },
    distribution: null,
  },
  {
    id: "ccc",
    code: "P-C",
    name: "อาคารซี",
    status: "active",
    settlement: null,
    distribution: null,
  },
];

beforeEach(() => {
  vi.mocked(settleProjectAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(distributeProjectCoinsAction).mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockReset();
});

describe("NovaSettlementList", () => {
  it("settles a closed, unsettled project", async () => {
    render(<NovaSettlementList projects={PROJECTS} />);
    const row = screen.getByTestId("proj-aaa");
    await userEvent.click(within(row).getByRole("button", { name: "สรุปกำไร" }));
    await waitFor(() => expect(settleProjectAction).toHaveBeenCalledWith("aaa"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("distributes a settled, undistributed project and shows its pool", async () => {
    render(<NovaSettlementList projects={PROJECTS} />);
    const row = screen.getByTestId("proj-bbb");
    expect(within(row).getByText(/16,?400/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "แบ่งเหรียญ" }));
    await waitFor(() => expect(distributeProjectCoinsAction).toHaveBeenCalledWith("bbb"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("offers no settle on an open project", () => {
    render(<NovaSettlementList projects={PROJECTS} />);
    const row = screen.getByTestId("proj-ccc");
    expect(within(row).queryByRole("button", { name: "สรุปกำไร" })).toBeNull();
  });

  it("surfaces an action error inline", async () => {
    vi.mocked(settleProjectAction).mockResolvedValue({ ok: false, error: "ปิดบัญชีไม่สำเร็จ" });
    render(<NovaSettlementList projects={PROJECTS} />);
    const row = screen.getByTestId("proj-aaa");
    await userEvent.click(within(row).getByRole("button", { name: "สรุปกำไร" }));
    await waitFor(() => expect(within(row).getByText("ปิดบัญชีไม่สำเร็จ")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
