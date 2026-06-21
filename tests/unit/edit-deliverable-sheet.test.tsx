// Writing failing test first.
//
// Spec 165 U1 — rename a งวด from the manager. PM/super/director edit the name;
// the setDeliverableName action (set_deliverable_name RPC) is the load-bearing
// path. code is shown read-only (immutable).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRename, mockRefresh } = vi.hoisted(() => ({
  mockRename: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ setDeliverableName: mockRename }));

import { EditDeliverableSheet } from "@/app/projects/[projectId]/edit-deliverable-sheet";

beforeEach(() => {
  mockRename.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<EditDeliverableSheet projectId="p1" deliverableId="d1" code="D01" name="ชื่อเดิม" />);
  fireEvent.click(screen.getByRole("button", { name: /แก้ไขงวด D01/ }));
}

describe("EditDeliverableSheet", () => {
  it("disables save until the name changes to a non-empty value", () => {
    open();
    const save = screen.getByRole("button", { name: "บันทึก" });
    expect(save).toBeDisabled(); // unchanged

    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "" } });
    expect(save).toBeDisabled(); // empty

    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "ชื่อใหม่" } });
    expect(save).toBeEnabled();
  });

  it("renames and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "ชื่อใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockRename).toHaveBeenCalledWith({
        projectId: "p1",
        deliverableId: "d1",
        name: "ชื่อใหม่",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockRename.mockResolvedValue({ ok: false, error: "เปลี่ยนชื่องวดไม่สำเร็จ" });
    open();
    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "ชื่อใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("เปลี่ยนชื่องวดไม่สำเร็จ"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
