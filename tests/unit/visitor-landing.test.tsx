// Spec 286 U1 — the organic-visitor landing (extracted from /coming-soon so it
// is unit-testable). It must offer BOTH self-onboard doors: the on-site
// (technician) door and the new office door. The invite note for
// subcontractors/clients is unchanged.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VisitorLanding } from "@/components/features/register/visitor-landing";
import { REGISTER_FIELD_HEADING, REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";

describe("VisitorLanding", () => {
  it("offers both a field and an office self-onboard door", () => {
    render(<VisitorLanding greeting="สวัสดี" lineAvatarUrl={null} fullName={null} />);

    const field = screen.getByRole("link", { name: REGISTER_FIELD_HEADING });
    const office = screen.getByRole("link", { name: REGISTER_OFFICE_HEADING });

    expect(field).toHaveAttribute("href", "/register/technician");
    expect(office).toHaveAttribute("href", "/register/office");
  });

  it("keeps the invite note for subcontractors/clients", () => {
    render(<VisitorLanding greeting="สวัสดี" lineAvatarUrl={null} fullName={null} />);
    expect(screen.getByText(/ได้รับลิงก์เชิญ/)).toBeInTheDocument();
  });
});
