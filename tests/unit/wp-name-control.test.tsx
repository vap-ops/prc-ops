// Spec 156: the WP name editor renames a work package inline. Save is disabled
// until the (trimmed, non-empty) name changes; clicking Save calls
// setWorkPackageName with the trimmed value.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

type NameInput = { projectId: string; workPackageId: string; name: string };
const setWorkPackageName = vi.fn(async (_input: NameInput) => ({ ok: true }) as const);
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/name-actions", () => ({
  setWorkPackageName: (input: NameInput) => setWorkPackageName(input),
}));
const fromResult = vi.fn();
vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => ({ fromResult }) }));

import { WpNameControl } from "@/components/features/work-packages/wp-name-control";

describe("WpNameControl", () => {
  beforeEach(() => {
    setWorkPackageName.mockClear();
    fromResult.mockClear();
  });

  it("renders the current name with Save disabled until it changes", () => {
    render(<WpNameControl projectId="p1" workPackageId="w1" name="งานเดิม" />);
    expect((screen.getByLabelText("ชื่องาน") as HTMLInputElement).value).toBe("งานเดิม");
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
  });

  it("enables Save on change and calls the action with the trimmed name", () => {
    render(<WpNameControl projectId="p1" workPackageId="w1" name="งานเดิม" />);
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "  งานใหม่  " } });
    const save = screen.getByRole("button", { name: "บันทึก" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(setWorkPackageName).toHaveBeenCalledWith({
      projectId: "p1",
      workPackageId: "w1",
      name: "งานใหม่",
    });
  });

  it("keeps Save disabled for a blank name", () => {
    render(<WpNameControl projectId="p1" workPackageId="w1" name="งานเดิม" />);
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
  });
});
