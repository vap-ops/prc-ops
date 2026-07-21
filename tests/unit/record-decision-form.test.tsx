// Writing failing test first.
//
// Spec 337 F3 changed what the third decision DOES: `rejected` used to record a
// comment and change nothing (0 uses ever, semantics undefined); it now sends
// the WORK back — the WP flips to งานแก้ไข, its rework round advances, and it
// leaves the review queue. A PM choosing between "ให้แก้ไข" (re-shoot the
// photos, item stays in the queue) and this one is choosing between two very
// different outcomes, so the option must NAME the outcome. Nothing else pins
// this copy, and a label that lies about behaviour is exactly the defect class
// this unit exists to remove.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/review/work-packages/[workPackageId]/actions", () => ({
  recordDecision: vi.fn(),
}));

import { RecordDecisionForm } from "@/app/review/work-packages/[workPackageId]/record-decision-form";

const WP = "11111111-1111-4111-8111-111111111111";

describe("RecordDecisionForm — spec 337 F3 decision copy", () => {
  it("names the send-back consequence on the rejected option", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getByText("ส่งกลับแก้งาน")).toBeInTheDocument();
    // The hint must say where the WP lands, not just that it was refused.
    expect(screen.getByText(/จะกลับไปเป็นงานแก้ไข/)).toBeInTheDocument();
  });

  it("retires the bare ไม่อนุมัติ label, which described the old inert behaviour", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.queryByText("ไม่อนุมัติ")).not.toBeInTheDocument();
  });

  it("keeps ให้แก้ไข distinct: photos only, and the item stays in the queue", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getByText("ให้แก้ไข")).toBeInTheDocument();
    expect(screen.getByText(/ยังอยู่ในคิวตรวจ/)).toBeInTheDocument();
  });

  it("offers exactly the three decisions", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});
