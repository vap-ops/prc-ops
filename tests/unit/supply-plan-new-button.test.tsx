import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Spec 189 U2 — the "new plan" button creates a draft plan then navigates to it.
const { mockCreate, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  createPlan: mockCreate,
}));

import { NewPlanButton } from "@/components/features/supply-plan/new-plan-button";

beforeEach(() => {
  mockCreate.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
});

describe("NewPlanButton", () => {
  it("creates a plan then navigates to ?plan=<id>", async () => {
    mockCreate.mockResolvedValue({ ok: true, planId: "newp" });
    render(<NewPlanButton projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "สร้างแผนใหม่" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ projectId: "p1" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("?plan=newp"));
  });

  it("shows an error and does not navigate when creation fails", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "สร้างไม่สำเร็จ" });
    render(<NewPlanButton projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "สร้างแผนใหม่" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("สร้างไม่สำเร็จ"));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
