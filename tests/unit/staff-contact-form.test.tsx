// Spec 317 U2/U1 — StaffContactForm: an approved office staffer edits their own
// CONTACT fields (instant tier, update_own_staff_contact). Coalesce-keep RPC —
// the form says เว้นว่าง = คงค่าเดิม and never offers a clear-field gesture.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateOwnStaffContact, mockRefresh } = vi.hoisted(() => ({
  updateOwnStaffContact: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/settings/my-info/actions", () => ({ updateOwnStaffContact }));
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

import { StaffContactForm } from "@/components/features/profile/staff-contact-form";

const INITIAL = {
  phone: "0812345678",
  emergencyName: "แม่",
  emergencyRelation: "แม่",
  emergencyPhone: "0899999999",
};

beforeEach(() => {
  updateOwnStaffContact.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("StaffContactForm", () => {
  it("prefills from initial and shows the keep-on-blank hint", () => {
    render(<StaffContactForm initial={INITIAL} />);
    expect(screen.getByDisplayValue("0812345678")).toBeInTheDocument();
    expect(screen.getByText(/เว้นว่าง = คงค่าเดิม/)).toBeInTheDocument();
  });

  it("saves the typed contact fields", async () => {
    render(<StaffContactForm initial={INITIAL} />);
    fireEvent.change(screen.getByDisplayValue("0812345678"), {
      target: { value: "0817778888" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updateOwnStaffContact).toHaveBeenCalledTimes(1));
    const arg = updateOwnStaffContact.mock.calls[0]?.[0] as { phone: string };
    expect(arg.phone).toBe("0817778888");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
