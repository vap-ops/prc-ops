import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Spec 245 U2 — picking a template and clicking clones it into a fresh plan,
// then navigates to it (mirrors NewPlanButton's ?plan=<id> pattern).
const { mockClone, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockClone: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  cloneSupplyPlanTemplate: mockClone,
}));

import { CloneTemplateButton } from "@/components/features/supply-plan/clone-template-button";

beforeEach(() => {
  mockClone.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
});

const templates = [
  { id: "t1", name: "TFM 16m" },
  { id: "t2", name: "TFM 20m" },
];

describe("CloneTemplateButton", () => {
  it("clones the selected template then navigates to ?plan=<id>", async () => {
    mockClone.mockResolvedValue({ ok: true, planId: "newp" });
    render(<CloneTemplateButton projectId="p1" templates={templates} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้เทมเพลตนี้" }));
    await waitFor(() =>
      expect(mockClone).toHaveBeenCalledWith({ templateId: "t2", projectId: "p1" }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("?plan=newp"));
  });

  it("shows an error and does not navigate when cloning fails", async () => {
    mockClone.mockResolvedValue({ ok: false, error: "สร้างไม่สำเร็จ" });
    render(<CloneTemplateButton projectId="p1" templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "ใช้เทมเพลตนี้" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("สร้างไม่สำเร็จ"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("renders nothing when there are no templates", () => {
    const { container } = render(<CloneTemplateButton projectId="p1" templates={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
