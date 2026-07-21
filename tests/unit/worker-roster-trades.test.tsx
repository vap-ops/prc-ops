// Writing failing test first.
//
// Spec 332 U2 — trade tags (สายงาน) on the roster. Row shows the worker's
// primary-first trade chips; the edit sheet offers a checkbox set + one primary
// radio, gated by canSetTrades (PM_ROLES). Saving diffs before calling the RPC.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh, mockSetTrades } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockSetTrades: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: vi.fn(),
  updateWorker: vi.fn().mockResolvedValue({ ok: true }),
  setWorkerDayRate: vi.fn().mockResolvedValue({ ok: true }),
  assignWorkerToProject: vi.fn().mockResolvedValue({ ok: true }),
  setWorkerLevel: vi.fn().mockResolvedValue({ ok: true }),
  setWorkerTrades: mockSetTrades,
  assignProjectHt: vi.fn(),
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import {
  WorkerRosterManager,
  type ManagedWorker,
  type TradeOption,
} from "@/components/features/labor/worker-roster-manager";

const OPTIONS: TradeOption[] = [
  { id: "cat-w01", code: "W01", nameTh: "งานเตรียมการ" },
  { id: "cat-w02", code: "W02", nameTh: "งานโครงสร้าง" },
  { id: "cat-w05", code: "W05", nameTh: "งานไฟฟ้า" },
];

const BASE: ManagedWorker = {
  id: "w1",
  name: "ช่างหนึ่ง",
  pay_type: "daily",
  contractor_id: null,
  day_rate: 500,
  active: true,
  note: null,
  employment_type: "permanent",
  portalBound: false,
  project_id: null,
  level: null,
  trades: [],
  phone: null,
  tax_id: null,
  bank_name: null,
  bank_account_number: null,
  bank_account_name: null,
};

function openEdit() {
  fireEvent.click(screen.getAllByRole("button", { name: "แก้ไข" })[0]!);
}

beforeEach(() => {
  mockRefresh.mockReset();
  mockSetTrades.mockReset().mockResolvedValue({ ok: true });
});

describe("spec 332 U2 — trade tags on the roster", () => {
  it("shows the primary trade chip first on the row", () => {
    render(
      <WorkerRosterManager
        workers={[
          {
            ...BASE,
            trades: [
              { categoryId: "cat-w05", code: "W05", nameTh: "งานไฟฟ้า", isPrimary: false },
              { categoryId: "cat-w01", code: "W01", nameTh: "งานเตรียมการ", isPrimary: true },
            ],
          },
        ]}
        contractors={[]}
      />,
    );
    const tiles = screen.getAllByTitle(/^W0\d$/);
    expect(tiles.map((t) => t.getAttribute("title"))).toEqual(["W01", "W05"]);
  });

  it("hides the trade editor unless canSetTrades", () => {
    const { unmount } = render(
      <WorkerRosterManager workers={[BASE]} contractors={[]} tradeOptions={OPTIONS} />,
    );
    openEdit();
    expect(screen.queryByLabelText("งานไฟฟ้า")).not.toBeInTheDocument();
    unmount();

    render(
      <WorkerRosterManager workers={[BASE]} contractors={[]} tradeOptions={OPTIONS} canSetTrades />,
    );
    openEdit();
    expect(screen.getByLabelText("งานไฟฟ้า")).toBeInTheDocument();
  });

  it("saves the selected trades with the chosen primary", async () => {
    render(
      <WorkerRosterManager workers={[BASE]} contractors={[]} tradeOptions={OPTIONS} canSetTrades />,
    );
    openEdit();
    fireEvent.click(screen.getByLabelText("งานเตรียมการ")); // W01
    fireEvent.click(screen.getByLabelText("งานไฟฟ้า")); // W05
    // primary radio appears once a trade is selected
    fireEvent.click(screen.getByLabelText("สายงานหลัก: งานไฟฟ้า"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockSetTrades).toHaveBeenCalledWith({
        id: "w1",
        categoryIds: ["cat-w01", "cat-w05"],
        primaryId: "cat-w05",
      }),
    );
  });

  it("does not call the RPC when the selection is unchanged", async () => {
    render(
      <WorkerRosterManager
        workers={[
          {
            ...BASE,
            trades: [
              { categoryId: "cat-w01", code: "W01", nameTh: "งานเตรียมการ", isPrimary: true },
            ],
          },
        ]}
        contractors={[]}
        tradeOptions={OPTIONS}
        canSetTrades
      />,
    );
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockSetTrades).not.toHaveBeenCalled();
  });

  it("drops the primary designation while keeping the trades", async () => {
    render(
      <WorkerRosterManager
        workers={[
          {
            ...BASE,
            trades: [
              { categoryId: "cat-w01", code: "W01", nameTh: "งานเตรียมการ", isPrimary: true },
              { categoryId: "cat-w05", code: "W05", nameTh: "งานไฟฟ้า", isPrimary: false },
            ],
          },
        ]}
        contractors={[]}
        tradeOptions={OPTIONS}
        canSetTrades
      />,
    );
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "ไม่ระบุสายงานหลัก" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockSetTrades).toHaveBeenCalledWith({
        id: "w1",
        categoryIds: ["cat-w01", "cat-w05"],
        primaryId: null,
      }),
    );
  });

  it("clears the primary when its trade is deselected", async () => {
    render(
      <WorkerRosterManager
        workers={[
          {
            ...BASE,
            trades: [
              { categoryId: "cat-w01", code: "W01", nameTh: "งานเตรียมการ", isPrimary: true },
            ],
          },
        ]}
        contractors={[]}
        tradeOptions={OPTIONS}
        canSetTrades
      />,
    );
    openEdit();
    // deselect the only (primary) trade, then add a different one with no primary
    fireEvent.click(screen.getByLabelText("งานเตรียมการ"));
    fireEvent.click(screen.getByLabelText("งานโครงสร้าง"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockSetTrades).toHaveBeenCalledWith({
        id: "w1",
        categoryIds: ["cat-w02"],
        primaryId: null,
      }),
    );
  });
});
