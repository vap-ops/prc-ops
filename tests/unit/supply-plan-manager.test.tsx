// Spec 176 U2/U3 + spec 181 U2 — the supply-plan planning screen. A planner (or
// procurement) builds the plan in an INLINE GRID: fill rows (item + WP + qty +
// note) and save them in one bulk write; remove saved lines; submit; an approver
// (PD/super) approves/rejects. Mocked actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBulkAdd, mockRemove, mockSubmit, mockApprove, mockReject, mockRefresh } = vi.hoisted(
  () => ({
    mockBulkAdd: vi.fn(),
    mockRemove: vi.fn(),
    mockSubmit: vi.fn(),
    mockApprove: vi.fn(),
    mockReject: vi.fn(),
    mockRefresh: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  bulkAddPlanLines: mockBulkAdd,
  removePlanLine: mockRemove,
  submitPlan: mockSubmit,
  approvePlan: mockApprove,
  rejectPlan: mockReject,
}));

import {
  SupplyPlanManager,
  type PlanLine,
  type PlanStatus,
} from "@/components/features/supply-plan/supply-plan-manager";

const catalogItems = [
  {
    id: "ci1",
    category: "electrical" as const,
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
  },
];
const workPackages = [{ id: "wp1", code: "WP-01", name: "งานก่อสร้าง" }];
const oneLine: PlanLine = {
  id: "l1",
  baseItem: "สายไฟ NYY",
  specAttrs: "3x6",
  unit: "ม้วน",
  qty: 10,
  wpLabel: "WP-01",
};

beforeEach(() => {
  mockBulkAdd.mockReset().mockResolvedValue({ ok: true, count: 1 });
  mockRemove.mockReset().mockResolvedValue({ ok: true });
  mockSubmit.mockReset().mockResolvedValue({ ok: true });
  mockApprove.mockReset().mockResolvedValue({ ok: true });
  mockReject.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderManager(opts: {
  planStatus: PlanStatus | null;
  planId?: string | null;
  canApprove?: boolean;
  lines?: PlanLine[];
}) {
  render(
    <SupplyPlanManager
      projectId="p1"
      planId={opts.planId ?? "pl1"}
      planStatus={opts.planStatus}
      canApprove={opts.canApprove ?? false}
      lines={opts.lines ?? []}
      catalogItems={catalogItems}
      workPackages={workPackages}
    />,
  );
}

describe("SupplyPlanManager grid (spec 181 U2)", () => {
  it("disables save until a row has an item and a positive qty (WP optional)", () => {
    renderManager({ planStatus: "draft" });
    const save = screen.getByRole("button", { name: /บันทึก/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    expect(save).toBeEnabled();
  });

  it("bulk-saves filled rows via bulkAddPlanLines", async () => {
    renderManager({ planStatus: "draft" });
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));

    await waitFor(() =>
      expect(mockBulkAdd).toHaveBeenCalledWith({
        projectId: "p1",
        lines: [{ catalogItemId: "ci1", workPackageId: "wp1", qty: 10, note: "" }],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("sends workPackageId null for a whole-project line (no WP chosen)", async () => {
    renderManager({ planStatus: "draft" });
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() =>
      expect(mockBulkAdd).toHaveBeenCalledWith({
        projectId: "p1",
        lines: [{ catalogItemId: "ci1", workPackageId: null, qty: 4, note: "" }],
      }),
    );
  });

  it("adds another row so multiple items can be entered at once", () => {
    renderManager({ planStatus: "draft" });
    expect(screen.getAllByLabelText("วัสดุ")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มแถว/ }));
    expect(screen.getAllByLabelText("วัสดุ")).toHaveLength(2);
  });

  it("removes a saved line", async () => {
    renderManager({ planStatus: "draft", lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ projectId: "p1", lineId: "l1" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("submits a draft plan for approval", async () => {
    renderManager({ planStatus: "draft", lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: "ส่งอนุมัติ" }));
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("an approver can approve or reject a submitted plan", async () => {
    renderManager({ planStatus: "submitted", canApprove: true, lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ตีกลับ" }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
  });

  it("a submitted plan is read-only to a non-approver (no grid / remove / approve)", () => {
    renderManager({ planStatus: "submitted", canApprove: false, lines: [oneLine] });
    expect(screen.queryByRole("button", { name: /บันทึก/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /เพิ่มแถว/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "ลบ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "อนุมัติ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งอนุมัติ" })).toBeNull();
  });
});
