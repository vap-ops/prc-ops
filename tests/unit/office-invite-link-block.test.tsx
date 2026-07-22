// tests/unit/office-invite-link-block.test.tsx
// Writing failing test first.
//
// Spec 342 U1.3 — the super_admin mint surface: pick an office role, generate,
// copy. The URL is built client-side from window.location.origin (no token, no
// server action — the link is a reusable pure-URL invite, D1).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const success = vi.fn();
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success, error: vi.fn() }),
}));

import { OfficeInviteLinkBlock } from "@/components/features/roles/office-invite-link-block";
import { OFFICE_INVITE_BLOCK_TITLE } from "@/lib/i18n/labels";

const INVITER = "223e4567-e89b-12d3-a456-426614174000";

beforeEach(() => success.mockReset());

describe("OfficeInviteLinkBlock", () => {
  it("generates a link carrying by + the picked role", async () => {
    const user = userEvent.setup();
    render(<OfficeInviteLinkBlock inviterId={INVITER} />);
    expect(screen.getByText(OFFICE_INVITE_BLOCK_TITLE)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("ตำแหน่ง"), "accounting");
    await user.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญ" }));

    const input = screen.getByDisplayValue(/register\/office/) as HTMLInputElement;
    const parsed = new URL(input.value);
    expect(parsed.pathname).toBe("/register/office");
    expect(parsed.searchParams.get("by")).toBe(INVITER);
    expect(parsed.searchParams.get("role")).toBe("accounting");
  });

  it("copies the link to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<OfficeInviteLinkBlock inviterId={INVITER} />);
    await user.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญ" }));
    await user.click(screen.getByRole("button", { name: "คัดลอกลิงก์" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("register/office"));
    expect(success).toHaveBeenCalled();
  });
});
