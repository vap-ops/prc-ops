// Writing failing test first.
//
// Spec 142 U5 — apply the project_type's WP template. PM/super tap it to seed
// the standard work packages for the project's type. Mocked action + router
// (apply_wp_template RPC carries DB correctness).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApply, mockRefresh } = vi.hoisted(() => ({
  mockApply: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ applyWpTemplate: mockApply }));

import { ApplyTemplateButton } from "@/app/projects/[projectId]/apply-template-button";

beforeEach(() => {
  mockApply.mockReset().mockResolvedValue({ ok: true, inserted: 7 });
  mockRefresh.mockReset();
});

describe("ApplyTemplateButton", () => {
  it("applies the template and refreshes on success", async () => {
    render(<ApplyTemplateButton projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /ใช้เทมเพลต/ }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error and does not refresh", async () => {
    mockApply.mockResolvedValue({ ok: false, error: "ใช้เทมเพลตไม่สำเร็จ" });
    render(<ApplyTemplateButton projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /ใช้เทมเพลต/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ใช้เทมเพลตไม่สำเร็จ"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
