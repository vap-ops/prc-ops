// Writing failing test first.
//
// Spec 233 / ADR 0067 U3 — the PD/super client-invite block. Pins: a valid-until
// date is required before issuing; a successful issue surfaces the copyable
// /client/claim link; active bindings render with a revoke control.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { createClientInvite, revokeClientAccess, updateClientAccessTier, toastSuccess, toastError } =
  vi.hoisted(() => ({
    createClientInvite: vi.fn(),
    revokeClientAccess: vi.fn(),
    updateClientAccessTier: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }));
vi.mock("@/app/projects/[projectId]/actions", () => ({
  createClientInvite,
  revokeClientAccess,
  updateClientAccessTier,
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { ClientInviteBlock } from "@/components/features/client-portal/client-invite-block";

beforeEach(() => {
  createClientInvite.mockReset();
  revokeClientAccess.mockReset();
  updateClientAccessTier.mockReset();
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

  it("issues a link with tier=basic by default", async () => {
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
        tier: "basic",
      }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/client\/claim\?token=tok-xyz/)).toBeInTheDocument(),
    );
  });

  it("issues a link with tier=full when the operator picks the full-tier radio", async () => {
    createClientInvite.mockResolvedValue({ ok: true, token: "tok-xyz" });
    render(<ClientInviteBlock projectId="p1" bindings={[]} />);
    fireEvent.change(screen.getByLabelText("ให้สิทธิ์เข้าถึงได้ถึงวันที่"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "เต็มรูปแบบ" }));
    fireEvent.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญลูกค้า" }));
    await waitFor(() =>
      expect(createClientInvite).toHaveBeenCalledWith({
        projectId: "p1",
        validUntil: "2026-12-31",
        tier: "full",
      }),
    );
  });

  it("renders active bindings with a revoke control + a tier select", () => {
    render(
      <ClientInviteBlock
        projectId="p1"
        bindings={[
          { id: "a1", name: "ลูกค้า ก", expiresAt: "2026-12-31T16:59:59+00:00", tier: "basic" },
        ]}
      />,
    );
    expect(screen.getByText(/ลูกค้า ก/)).toBeInTheDocument();
    expect(screen.getByText(/2026-12-31/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิกถอน" })).toBeInTheDocument();
    expect(screen.getByLabelText("ระดับสิทธิ์ของ ลูกค้า ก")).toHaveValue("basic");
  });

  it("changing a binding's tier select calls updateClientAccessTier", async () => {
    updateClientAccessTier.mockResolvedValue({ ok: true });
    render(
      <ClientInviteBlock
        projectId="p1"
        bindings={[
          { id: "a1", name: "ลูกค้า ก", expiresAt: "2026-12-31T16:59:59+00:00", tier: "basic" },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText("ระดับสิทธิ์ของ ลูกค้า ก"), {
      target: { value: "full" },
    });
    await waitFor(() =>
      expect(updateClientAccessTier).toHaveBeenCalledWith({
        accessId: "a1",
        projectId: "p1",
        tier: "full",
      }),
    );
  });
});
