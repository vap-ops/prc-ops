// Spec 317 U2/U3 — IdentityChangeForm: propose a legal-name / national-ID / DOB
// change (the approved tier). At least one field required; lands PENDING for the
// staff-approval trio. While pending, the form is replaced by a waiting notice.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitIdentityChange, mockRefresh } = vi.hoisted(() => ({
  submitIdentityChange: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/settings/my-info/actions", () => ({ submitIdentityChange }));
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

import { IdentityChangeForm } from "@/components/features/profile/identity-change-form";
import { IDENTITY_CHANGE_PENDING } from "@/lib/i18n/labels";

beforeEach(() => {
  submitIdentityChange.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("IdentityChangeForm", () => {
  it("shows the waiting notice while a request is pending", () => {
    render(<IdentityChangeForm hasPending={true} />);
    expect(screen.getByText(IDENTITY_CHANGE_PENDING)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งคำขอแก้ไขข้อมูลตัวตน" })).toBeNull();
  });

  it("refuses an all-empty submit", async () => {
    render(<IdentityChangeForm hasPending={false} />);
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไขข้อมูลตัวตน" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(submitIdentityChange).not.toHaveBeenCalled();
  });

  it("submits a name-only proposal", async () => {
    render(<IdentityChangeForm hasPending={false} />);
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุลใหม่/), {
      target: { value: "ชื่อใหม่ ทดสอบ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไขข้อมูลตัวตน" }));
    await waitFor(() => expect(submitIdentityChange).toHaveBeenCalledTimes(1));
    const arg = submitIdentityChange.mock.calls[0]?.[0] as { fullName: string };
    expect(arg.fullName).toBe("ชื่อใหม่ ทดสอบ");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("rejects a national ID that is not 13 digits before calling the action", async () => {
    render(<IdentityChangeForm hasPending={false} />);
    fireEvent.change(screen.getByLabelText(/เลขบัตรประชาชนใหม่/), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไขข้อมูลตัวตน" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(submitIdentityChange).not.toHaveBeenCalled();
  });

  // Spec 321 U6 — the contractor surface proposes DOB only (name/national-ID are
  // party fields for a contractor, not personal identity).
  describe("dobOnly", () => {
    it("renders only the DOB field", () => {
      render(<IdentityChangeForm hasPending={false} dobOnly />);
      expect(screen.getByLabelText(/วันเกิด/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/ชื่อ-นามสกุลใหม่/)).toBeNull();
      expect(screen.queryByLabelText(/เลขบัตรประชาชนใหม่/)).toBeNull();
    });

    it("submits a DOB-only proposal", async () => {
      render(<IdentityChangeForm hasPending={false} dobOnly />);
      fireEvent.change(screen.getByLabelText(/วันเกิด/), { target: { value: "1990-05-01" } });
      fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไขวันเกิด" }));
      await waitFor(() => expect(submitIdentityChange).toHaveBeenCalledTimes(1));
      const arg = submitIdentityChange.mock.calls[0]?.[0] as {
        fullName: string;
        nationalId: string;
        dob: string;
      };
      expect(arg.dob).toBe("1990-05-01");
      expect(arg.fullName).toBe("");
      expect(arg.nationalId).toBe("");
      await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    });

    it("refuses an empty submit", async () => {
      render(<IdentityChangeForm hasPending={false} dobOnly />);
      fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไขวันเกิด" }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(submitIdentityChange).not.toHaveBeenCalled();
    });

    it("still shows the waiting notice while pending", () => {
      render(<IdentityChangeForm hasPending={true} dobOnly />);
      expect(screen.getByText(IDENTITY_CHANGE_PENDING)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "ส่งคำขอแก้ไขวันเกิด" })).toBeNull();
    });
  });
});
