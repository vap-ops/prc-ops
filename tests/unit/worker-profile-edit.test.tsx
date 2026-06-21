// Spec 170 U4b — WorkerProfileEdit: a DC worker self-edits their portal profile
// (contact + emergency + DOB) in one form, prefilled from get_my_worker_profile.
// Direct apply via update_own_worker_profile (column-scoped server-side). Mirrors
// the contractor PortalContactInfo / PortalSelfEdit pattern.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { updateOwnWorkerProfile, mockRefresh } = vi.hoisted(() => ({
  updateOwnWorkerProfile: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/lib/portal/actions", () => ({ updateOwnWorkerProfile }));
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

import { WorkerProfileEdit } from "@/components/features/portal/worker-profile-edit";

describe("WorkerProfileEdit", () => {
  beforeEach(() => {
    updateOwnWorkerProfile.mockReset();
  });

  it("prefills the editable profile fields from initial", () => {
    render(
      <WorkerProfileEdit
        initial={{
          phone: "0812345678",
          email: "a@b.co",
          emergencyName: "แม่",
          emergencyRelation: "แม่",
          emergencyPhone: "0899999999",
          dob: "1990-05-01",
        }}
      />,
    );
    expect(screen.getByDisplayValue("0812345678")).toBeInTheDocument();
    expect(screen.getByDisplayValue("a@b.co")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0899999999")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeInTheDocument();
  });
});
