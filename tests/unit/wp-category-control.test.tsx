// Writing failing test first.
//
// Spec 226 / 207 U3c — WpCategoryControl: the จัดการ-tab control that binds a WP
// to exactly one of its project's active work-categories (the locked
// one-category-per-WP rule, a single FK), via the already-shipped
// set_work_package_category RPC. A native select; choosing writes through the
// mocked setWorkPackageCategory action. Pins: active-only options (render a
// bound-inactive as the current value), the binding call shape, and the
// empty-state nudge on an uncategorised WP.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockFromResult } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockFromResult: vi.fn(),
}));

vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => ({ fromResult: mockFromResult }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/category-actions", () => ({
  setWorkPackageCategory: mockSet,
}));

import { WpCategoryControl } from "@/components/features/work-packages/wp-category-control";

const cats = [
  { id: "a1", code: "W02", name: "งานโครงสร้าง", is_active: true },
  { id: "a2", code: "W03", name: "งานสถาปัตยกรรม", is_active: true },
  { id: "i1", code: "W09", name: "งานเก่า", is_active: false },
];

beforeEach(() => {
  mockSet.mockReset().mockResolvedValue({ ok: true });
  mockFromResult.mockReset();
});

describe("WpCategoryControl", () => {
  it("renders the project's active categories as options (inactive hidden)", () => {
    render(
      <WpCategoryControl projectId="p1" workPackageId="wp1" categoryId={null} categories={cats} />,
    );
    expect(screen.getByRole("option", { name: /งานโครงสร้าง/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /งานสถาปัตยกรรม/ })).toBeInTheDocument();
    // The inactive category is not offered when it is not the current binding.
    expect(screen.queryByRole("option", { name: /งานเก่า/ })).not.toBeInTheDocument();
  });

  it("binds the WP to the chosen category via the action", async () => {
    render(
      <WpCategoryControl projectId="p1" workPackageId="wp1" categoryId={null} categories={cats} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a1" } });
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        categoryId: "a1",
      }),
    );
  });

  it("uncategorises the WP when the sentinel option is chosen", async () => {
    render(
      <WpCategoryControl projectId="p1" workPackageId="wp1" categoryId="a1" categories={cats} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        categoryId: null,
      }),
    );
  });

  it("still renders an already-bound INACTIVE category as the current value", () => {
    render(
      <WpCategoryControl projectId="p1" workPackageId="wp1" categoryId="i1" categories={cats} />,
    );
    // bound-inactive is rendered (so the binding is visible) and selected.
    expect(screen.getByRole("option", { name: /งานเก่า/ })).toBeInTheDocument();
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("i1");
  });

  it("shows an empty-state nudge when the WP has no category", () => {
    render(
      <WpCategoryControl projectId="p1" workPackageId="wp1" categoryId={null} categories={cats} />,
    );
    expect(screen.getByText(/ยังไม่ได้เลือกหมวดงาน/)).toBeInTheDocument();
  });

  it("hides the nudge once a category is bound", () => {
    render(
      <WpCategoryControl projectId="p1" workPackageId="wp1" categoryId="a1" categories={cats} />,
    );
    expect(screen.queryByText(/ยังไม่ได้เลือกหมวดงาน/)).not.toBeInTheDocument();
  });
});
