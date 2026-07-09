// Writing failing test first.
//
// Spec 284 U5 — the Legal role's home surface. `LegalHome` is the pure view the
// /legal Server Component renders after requireRole(LEGAL_ROLES) + admin-client
// counts: it shows the two working counts (active contracts, pending approvals)
// and the two entry cards (สัญญา → /legal/contracts, เอกสารรออนุมัติ →
// /legal/approvals). This pins the counts + entry links; the page's data load is
// exercised by the real-browser check, not here.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegalHome } from "@/components/features/legal/legal-home";

describe("LegalHome — spec 284 U5", () => {
  it("shows the contracts + approvals entry cards linking to their surfaces", () => {
    render(<LegalHome activeContracts={3} pendingApprovals={2} />);

    // Contracts entry — links to the contracts list.
    const contracts = screen.getByRole("link", { name: /สัญญา/ });
    expect(contracts).toHaveAttribute("href", "/legal/contracts");

    // Approvals entry — links to the pending-approval queue.
    const approvals = screen.getByRole("link", { name: /รออนุมัติ/ });
    expect(approvals).toHaveAttribute("href", "/legal/approvals");
  });

  it("renders each entry's live count inside its card", () => {
    render(<LegalHome activeContracts={3} pendingApprovals={2} />);

    const contracts = screen.getByRole("link", { name: /สัญญา/ });
    expect(within(contracts).getByText("3")).toBeInTheDocument();

    const approvals = screen.getByRole("link", { name: /รออนุมัติ/ });
    expect(within(approvals).getByText("2")).toBeInTheDocument();
  });
});
