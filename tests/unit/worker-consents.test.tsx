// Spec 170 U4b-2 — WorkerConsents: a DC worker gives/withdraws PDPA +
// background-check consent on /portal. Mirrors the contractor ConsentCard but
// records via record_worker_consent (self-scoped to the bound worker).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { recordOwnWorkerConsent, revokeOwnConsent, mockRefresh } = vi.hoisted(() => ({
  recordOwnWorkerConsent: vi.fn(),
  revokeOwnConsent: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/lib/portal/actions", () => ({ recordOwnWorkerConsent, revokeOwnConsent }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { WorkerConsents } from "@/components/features/portal/worker-consents";

describe("WorkerConsents", () => {
  beforeEach(() => {
    recordOwnWorkerConsent.mockReset();
    revokeOwnConsent.mockReset();
  });

  it("offers consent for a kind the worker has not yet given", () => {
    render(<WorkerConsents consents={[]} />);
    // Both kinds render an opt-in button when no active consent exists.
    expect(screen.getAllByRole("button", { name: "ยินยอม" })).toHaveLength(2);
  });

  it("shows a withdraw affordance for an active consent", () => {
    render(
      <WorkerConsents
        consents={[{ id: "c1", kind: "pdpa_data", consented_at: "2026-06-01", revoked_at: null }]}
      />,
    );
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeInTheDocument();
    // Only background_check still needs opt-in.
    expect(screen.getAllByRole("button", { name: "ยินยอม" })).toHaveLength(1);
  });
});
