// Writing failing test first.
//
// Spec 142 U3 — the onboarding checklist on the project page. Derived from
// project_onboarding_status booleans: each unmet item is a deep link, each met
// item shows a done marker. Hidden once dismissed or fully complete. Mocked
// dismiss action + router (the RPC carries DB correctness; this covers wiring).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDismiss, mockRefresh } = vi.hoisted(() => ({
  mockDismiss: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ dismissProjectOnboarding: mockDismiss }));

import {
  OnboardingChecklist,
  type OnboardingStatus,
} from "@/app/projects/[projectId]/onboarding-checklist";

const FRESH: OnboardingStatus = {
  dates_lead_set: false,
  budget_set: false,
  team_added: false,
  work_packages_added: false,
  client_set: false,
  dismissed: false,
};

beforeEach(() => {
  mockDismiss.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("OnboardingChecklist", () => {
  it("renders the setup heading and a settings deep-link when items are unmet", () => {
    render(<OnboardingChecklist projectId="p1" status={FRESH} />);
    expect(screen.getByText("เริ่มต้นโครงการ")).toBeInTheDocument();
    const settingsLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/projects/p1/settings");
    expect(settingsLinks.length).toBeGreaterThan(0);
  });

  it("marks met items done (one done marker per met item)", () => {
    render(
      <OnboardingChecklist
        projectId="p1"
        status={{ ...FRESH, dates_lead_set: true, team_added: true }}
      />,
    );
    expect(screen.getAllByLabelText("เสร็จแล้ว")).toHaveLength(2);
  });

  it("renders nothing once dismissed", () => {
    render(<OnboardingChecklist projectId="p1" status={{ ...FRESH, dismissed: true }} />);
    expect(screen.queryByText("เริ่มต้นโครงการ")).not.toBeInTheDocument();
  });

  it("renders nothing once every item is complete", () => {
    render(
      <OnboardingChecklist
        projectId="p1"
        status={{
          dates_lead_set: true,
          budget_set: true,
          team_added: true,
          work_packages_added: true,
          client_set: true,
          dismissed: false,
        }}
      />,
    );
    expect(screen.queryByText("เริ่มต้นโครงการ")).not.toBeInTheDocument();
  });

  it("dismisses and refreshes when the hide button is clicked", async () => {
    render(<OnboardingChecklist projectId="p1" status={FRESH} />);
    fireEvent.click(screen.getByRole("button", { name: /ซ่อน/ }));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
