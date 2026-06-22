// Spec 176 U2/U3 — the supply-plan planning screen. A planner adds/removes lines
// on a draft (or rejected) plan, submits it; an approver (PD/super) approves or
// rejects. Mocked actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRemove, mockSubmit, mockApprove, mockReject, mockRefresh } = vi.hoisted(
  () => ({
    mockAdd: vi.fn(),
    mockRemove: vi.fn(),
    mockSubmit: vi.fn(),
    mockApprove: vi.fn(),
    mockReject: vi.fn(),
    mockRefresh: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  addPlanLine: mockAdd,
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
  mockAdd.mockReset().mockResolvedValue({ ok: true });
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

describe("SupplyPlanManager (spec 176 U2/U3)", () => {
  it("disables submit until item, WP and qty are set", () => {
    renderManager({ planStatus: "draft" });
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการแผน/ }));
    const submit = screen.getByRole("button", { name: "เพิ่ม" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    expect(submit).toBeEnabled();
  });

  it("adds a line with the chosen item, WP and qty", async () => {
    renderManager({ planStatus: "draft" });
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการแผน/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่ม" }));

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        workPackageId: "wp1",
        qty: 10,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removes a line", async () => {
    renderManager({ planStatus: "draft", lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: /ลบ/ }));
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

  it("a submitted plan is read-only to a non-approver (no add / remove / approve)", () => {
    renderManager({ planStatus: "submitted", canApprove: false, lines: [oneLine] });
    expect(screen.queryByRole("button", { name: /เพิ่มรายการแผน/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ลบ/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "อนุมัติ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งอนุมัติ" })).toBeNull();
  });
});
