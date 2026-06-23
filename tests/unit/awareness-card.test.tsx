// Spec 185 U1 — the generic dashboard awareness card. Renders ONLY when its
// count is positive (exception-driven, no zero-state clutter), shows the count +
// label, and links to the decision surface. One component for the purchase-
// request and bank-change cards (and any future approval type).

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Landmark } from "lucide-react";
import { AwarenessCard } from "@/components/features/dashboard/awareness-card";

describe("AwarenessCard", () => {
  it("renders nothing when count is zero or negative", () => {
    const { container } = render(
      <AwarenessCard count={0} label="การเปลี่ยนบัญชีรอการอนุมัติ" href="/x" icon={Landmark} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the count + label and links to the decision surface", () => {
    render(<AwarenessCard count={2} label="คำขอซื้อรอพิจารณา" href="/requests" icon={Landmark} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/requests");
    expect(link.textContent).toContain("2");
    expect(link.textContent).toContain("คำขอซื้อรอพิจารณา");
  });
});
