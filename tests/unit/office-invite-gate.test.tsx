// Writing failing test first.
// Spec 342 D3 — the gate is a guidance screen, never a 404: it names the
// requirement, offers the field door, and says who to ask.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfficeInviteGate } from "@/components/features/register/office-invite-gate";
import {
  OFFICE_INVITE_REQUIRED_HEADING,
  OFFICE_INVITE_REQUIRED_HINT,
  REGISTER_FIELD_HEADING,
} from "@/lib/i18n/labels";

describe("OfficeInviteGate", () => {
  it("explains the invite requirement and offers the field door", () => {
    render(<OfficeInviteGate />);
    expect(screen.getByText(OFFICE_INVITE_REQUIRED_HEADING)).toBeInTheDocument();
    expect(screen.getByText(OFFICE_INVITE_REQUIRED_HINT)).toBeInTheDocument();
    const fieldDoor = screen.getByRole("link", { name: REGISTER_FIELD_HEADING });
    expect(fieldDoor).toHaveAttribute("href", "/register/technician");
  });
});
