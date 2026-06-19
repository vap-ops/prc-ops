// Spec 155: the WP deliverable control binds/clears a WP's งวดงาน. It renders an
// ungrouped option + every deliverable, reflects the current binding, and calls
// setWorkPackageDeliverable with the chosen id (or null when ungrouped).

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

type DeliverableInput = { projectId: string; workPackageId: string; deliverableId: string | null };
const setWorkPackageDeliverable = vi.fn(
  async (_input: DeliverableInput) => ({ ok: true }) as const,
);
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/deliverable-actions", () => ({
  setWorkPackageDeliverable: (input: DeliverableInput) => setWorkPackageDeliverable(input),
}));
const fromResult = vi.fn();
vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => ({ fromResult }) }));

import { WpDeliverableControl } from "@/components/features/work-packages/wp-deliverable-control";

const DELIVERABLES = [
  { id: "11111111-1111-1111-1111-111111111111", code: "D01", name: "งวดหนึ่ง" },
  { id: "22222222-2222-2222-2222-222222222222", code: "D02", name: "งวดสอง" },
];

describe("WpDeliverableControl", () => {
  beforeEach(() => {
    setWorkPackageDeliverable.mockClear();
    fromResult.mockClear();
  });

  it("renders the ungrouped option + every deliverable, current selected", () => {
    render(
      <WpDeliverableControl
        projectId="p1"
        workPackageId="w1"
        deliverableId="22222222-2222-2222-2222-222222222222"
        deliverables={DELIVERABLES}
      />,
    );
    const select = screen.getByLabelText("งวดงานของงาน") as HTMLSelectElement;
    expect(select.value).toBe("22222222-2222-2222-2222-222222222222");
    expect(screen.getByRole("option", { name: "ยังไม่จัดกลุ่ม" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "D01 · งวดหนึ่ง" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "D02 · งวดสอง" })).toBeInTheDocument();
  });

  it("binds to the chosen deliverable", () => {
    render(
      <WpDeliverableControl
        projectId="p1"
        workPackageId="w1"
        deliverableId={null}
        deliverables={DELIVERABLES}
      />,
    );
    fireEvent.change(screen.getByLabelText("งวดงานของงาน"), {
      target: { value: "11111111-1111-1111-1111-111111111111" },
    });
    expect(setWorkPackageDeliverable).toHaveBeenCalledWith({
      projectId: "p1",
      workPackageId: "w1",
      deliverableId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("clears to null when choosing ungrouped", () => {
    render(
      <WpDeliverableControl
        projectId="p1"
        workPackageId="w1"
        deliverableId="11111111-1111-1111-1111-111111111111"
        deliverables={DELIVERABLES}
      />,
    );
    fireEvent.change(screen.getByLabelText("งวดงานของงาน"), { target: { value: "" } });
    expect(setWorkPackageDeliverable).toHaveBeenCalledWith({
      projectId: "p1",
      workPackageId: "w1",
      deliverableId: null,
    });
  });
});
