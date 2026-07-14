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

beforeEach(() => {
  submitIdentityChange.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("IdentityChangeForm", () => {
  it("shows the waiting notice while a request is pending", () => {
    render(<IdentityChangeForm hasPending={true} />);
    expect(screen.getByText(/กำลังรอ/)).toBeInTheDocument();
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
});
