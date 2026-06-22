// Writing failing test first.
//
// Spec 176 U2 — the supply-plan planning screen. A planner adds lines (catalog
// item + WP + qty) to a draft plan and removes them; a submitted (frozen) plan
// is read-only. Mocked actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRemove, mockRefresh } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockRemove: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  addPlanLine: mockAdd,
  removePlanLine: mockRemove,
}));

import {
  SupplyPlanManager,
  type PlanLine,
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

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true });
  mockRemove.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderDraft(lines: PlanLine[] = []) {
  render(
    <SupplyPlanManager
      projectId="p1"
      planStatus="draft"
      lines={lines}
      catalogItems={catalogItems}
      workPackages={workPackages}
    />,
  );
}

describe("SupplyPlanManager (spec 176 U2)", () => {
  it("disables submit until item, WP and qty are set", () => {
    renderDraft();
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการแผน/ }));
    const submit = screen.getByRole("button", { name: "เพิ่ม" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    expect(submit).toBeEnabled();
  });

  it("adds a line with the chosen item, WP and qty", async () => {
    renderDraft();
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
    renderDraft([
      {
        id: "l1",
        baseItem: "สายไฟ NYY",
        specAttrs: "3x6",
        unit: "ม้วน",
        qty: 10,
        wpLabel: "WP-01",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /ลบ/ }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ projectId: "p1", lineId: "l1" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("a submitted (frozen) plan is read-only — no add or remove", () => {
    render(
      <SupplyPlanManager
        projectId="p1"
        planStatus="submitted"
        lines={[
          {
            id: "l1",
            baseItem: "สายไฟ NYY",
            specAttrs: "3x6",
            unit: "ม้วน",
            qty: 10,
            wpLabel: "WP-01",
          },
        ]}
        catalogItems={catalogItems}
        workPackages={workPackages}
      />,
    );
    expect(screen.queryByRole("button", { name: /เพิ่มรายการแผน/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ลบ/ })).toBeNull();
  });
});
