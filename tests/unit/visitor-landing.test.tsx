// Spec 342 D3 — the organic-visitor landing on /coming-soon. The office door is
// invite-only; /coming-soon offers ONLY the field door. The ask-for-a-link line
// names who to contact for an office invite. The invite note for
// subcontractors/clients is unchanged.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VisitorLanding } from "@/components/features/register/visitor-landing";
import {
  REGISTER_FIELD_HEADING,
  OFFICE_ASK_INVITE_LINE,
  REGISTER_OFFICE_HEADING,
} from "@/lib/i18n/labels";

describe("VisitorLanding", () => {
  it("offers the field door only; office becomes an ask-for-a-link line", () => {
    render(<VisitorLanding greeting="สวัสดี" lineAvatarUrl={null} fullName={null} />);

    const field = screen.getByRole("link", { name: REGISTER_FIELD_HEADING });
    expect(field).toHaveAttribute("href", "/register/technician");
    // Spec 342 D3 — no office LINK; the line names who to ask instead.
    expect(screen.queryByRole("link", { name: REGISTER_OFFICE_HEADING })).not.toBeInTheDocument();
    expect(screen.getByText(OFFICE_ASK_INVITE_LINE)).toBeInTheDocument();
  });

  it("keeps the invite note for subcontractors/clients", () => {
    render(<VisitorLanding greeting="สวัสดี" lineAvatarUrl={null} fullName={null} />);
    expect(screen.getByText(/ได้รับลิงก์เชิญ/)).toBeInTheDocument();
  });
});
