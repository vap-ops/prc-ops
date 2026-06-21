// Writing failing test first.
//
// Spec 164 U1 — add a งวดงาน (deliverable) from the project page. PM/super/
// director enter code + name; the createDeliverable action (and the SECURITY
// DEFINER create_deliverable RPC beneath it) carry the real validation.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ createDeliverable: mockCreate }));

import { AddDeliverableSheet } from "@/app/projects/[projectId]/add-deliverable-sheet";

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true, id: "d1" });
  mockRefresh.mockReset();
});

function open() {
  render(<AddDeliverableSheet projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มงวด/ }));
}

describe("AddDeliverableSheet", () => {
  it("disables submit until code and name are entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "สร้างงวด" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("รหัสงวด"), { target: { value: "D01" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "งานเตรียมพื้นที่" } });
    expect(submit).toBeEnabled();
  });

  it("creates the deliverable and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("รหัสงวด"), { target: { value: "D01" } });
    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "งานเตรียมพื้นที่" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงวด" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        projectId: "p1",
        code: "D01",
        name: "งานเตรียมพื้นที่",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "รหัสงวดนี้มีอยู่แล้ว" });
    open();
    fireEvent.change(screen.getByLabelText("รหัสงวด"), { target: { value: "D01" } });
    fireEvent.change(screen.getByLabelText("ชื่องวด"), { target: { value: "ซ้ำ" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงวด" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("รหัสงวดนี้มีอยู่แล้ว"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
