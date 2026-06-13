// Spec 72: the project settings form gains a notes textarea, batched into
// its single save alongside name + status.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/sa/projects/[projectId]/settings/actions", () => ({
  updateProjectSettings: mockUpdate,
}));

import { SettingsForm } from "@/app/sa/projects/[projectId]/settings/settings-form";

describe("SettingsForm notes", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRefresh.mockReset();
  });

  it("seeds the notes textarea from initialNotes", () => {
    render(
      <SettingsForm
        projectId="p"
        initialName="N"
        initialStatus="active"
        initialNotes="โน้ตโครงการ"
      />,
    );
    expect(screen.getByLabelText("หมายเหตุ")).toHaveValue("โน้ตโครงการ");
  });

  it("submits name, status and notes together", async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    render(
      <SettingsForm
        projectId="p"
        initialName="ชื่อเดิม"
        initialStatus="active"
        initialNotes={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "โน้ตใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        projectId: "p",
        name: "ชื่อเดิม",
        status: "active",
        notes: "โน้ตใหม่",
      }),
    );
  });
});
