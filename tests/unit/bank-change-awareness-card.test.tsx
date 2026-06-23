// Spec 184 U2 — the bank-change awareness card on the PM dashboard. Bank-change
// approvals have no nav surface (only a contractor's detail page), so the
// dashboard is where the PM finds out one is waiting. Exception-driven: the card
// renders ONLY when something is pending (unlike the always-present รอตรวจ card),
// and links to the contractor list to drill in and decide.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BankChangeAwarenessCard } from "@/components/features/dashboard/bank-change-awareness-card";

describe("BankChangeAwarenessCard", () => {
  it("renders nothing when no bank change is pending", () => {
    const { container } = render(<BankChangeAwarenessCard count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the pending count and links to the contractor list", () => {
    render(<BankChangeAwarenessCard count={2} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/contacts/subcontractors");
    expect(link.textContent).toContain("2");
    expect(link.textContent).toContain("บัญชี");
  });
});
