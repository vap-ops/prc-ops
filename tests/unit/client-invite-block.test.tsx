// Writing failing test first.
//
// Spec 233 / ADR 0067 U3 — the PD/super client-invite block. Pins: a valid-until
// date is required before issuing; a successful issue surfaces the copyable
// /client/claim link; active bindings render with a revoke control.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { createClientInvite, revokeClientAccess, toastSuccess, toastError } = vi.hoisted(() => ({
  createClientInvite: vi.fn(),
  revokeClientAccess: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/app/projects/[projectId]/actions", () => ({ createClientInvite, revokeClientAccess }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { ClientInviteBlock } from "@/components/features/client-portal/client-invite-block";

beforeEach(() => {
  createClientInvite.mockReset();
  revokeClientAccess.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ClientInviteBlock", () => {
  it("requires a valid-until date before issuing", () => {
    render(<ClientInviteBlock projectId="p1" bindings={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญลูกค้า" }));
    expect(createClientInvite).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("กรุณาเลือกวันหมดอายุ");
  });

  it("issues a link and shows the copyable /client/claim url", async () => {
    createClientInvite.mockResolvedValue({ ok: true, token: "tok-xyz" });
    render(<ClientInviteBlock projectId="p1" bindings={[]} />);
    fireEvent.change(screen.getByLabelText("ให้สิทธิ์เข้าถึงได้ถึงวันที่"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญลูกค้า" }));
    await waitFor(() =>
      expect(createClientInvite).toHaveBeenCalledWith({
        projectId: "p1",
        validUntil: "2026-12-31",
      }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/client\/claim\?token=tok-xyz/)).toBeInTheDocument(),
    );
  });

  it("renders active bindings with a revoke control", () => {
    render(
      <ClientInviteBlock
        projectId="p1"
        bindings={[{ id: "a1", name: "ลูกค้า ก", expiresAt: "2026-12-31T16:59:59+00:00" }]}
      />,
    );
    expect(screen.getByText(/ลูกค้า ก/)).toBeInTheDocument();
    expect(screen.getByText(/2026-12-31/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิกถอน" })).toBeInTheDocument();
  });
});
