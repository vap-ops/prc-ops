// Writing failing test first.
//
// Spec 234 / ADR 0067 U3 — the PD "grant an existing client login" picker:
// renders nothing without candidates; picking a client + date + tapping grant
// relays to grantClientAccess and toasts on success.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { grantClientAccess, toastSuccess, toastError } = vi.hoisted(() => ({
  grantClientAccess: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/app/projects/[projectId]/actions", () => ({ grantClientAccess }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { ClientGrantExisting } from "@/components/features/client-portal/client-grant-existing";

beforeEach(() => {
  grantClientAccess.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ClientGrantExisting", () => {
  it("shows a hint (and no client picker) when there are no candidate clients", () => {
    render(<ClientGrantExisting projectId="p1" candidates={[]} />);
    // discoverable: the card + an explanatory hint, not a hidden component
    expect(screen.getByText(/ยังไม่มีลูกค้าที่เคยเข้าถึงโครงการอื่น/)).toBeInTheDocument();
    expect(screen.queryByLabelText("ลูกค้าที่มีอยู่")).toBeNull();
  });

  it("grants the picked client for the chosen date", async () => {
    grantClientAccess.mockResolvedValue({ ok: true });
    render(<ClientGrantExisting projectId="p1" candidates={[{ id: "u1", name: "ลูกค้า ก" }]} />);
    fireEvent.change(screen.getByLabelText("ลูกค้าที่มีอยู่"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("ให้สิทธิ์เข้าถึงได้ถึงวันที่"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ให้สิทธิ์เข้าถึง" }));
    await waitFor(() =>
      expect(grantClientAccess).toHaveBeenCalledWith({
        userId: "u1",
        projectId: "p1",
        validUntil: "2026-12-31",
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
