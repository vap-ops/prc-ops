// Writing failing test first.
//
// Spec 165 U4 — delete an EMPTY งวด from its detail page. Guarded by the themed
// ConfirmDialog (no window.confirm). On success the งวด is gone → navigate to
// the project. Mirrors WpDeleteControl. A populated งวด is refused by the RPC.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDelete, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("@/app/projects/[projectId]/actions", () => ({ deleteDeliverable: mockDelete }));

import { DeleteDeliverableButton } from "@/app/projects/[projectId]/delete-deliverable-button";

beforeEach(() => {
  mockDelete.mockReset().mockResolvedValue({ ok: true });
  mockPush.mockReset();
  mockRefresh.mockReset();
});

describe("DeleteDeliverableButton", () => {
  it("deletes after the themed confirm and navigates to the project", async () => {
    render(<DeleteDeliverableButton projectId="p1" deliverableId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: /ลบงวด/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบถาวร" }));

    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({ projectId: "p1", deliverableId: "d1" }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it("shows the action error inline and does not navigate", async () => {
    mockDelete.mockResolvedValue({ ok: false, error: "งวดนี้ยังมีงาน เอางานออกก่อน" });
    render(<DeleteDeliverableButton projectId="p1" deliverableId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: /ลบงวด/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบถาวร" }));

    await waitFor(() =>
      expect(screen.getByText("งวดนี้ยังมีงาน เอางานออกก่อน")).toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
