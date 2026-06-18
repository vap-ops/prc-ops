// Writing failing test first.
//
// Spec 142 U4 — the "add work package" sheet on the project page. PM/super open
// it, type a code + name (+ optional description), and the new WP appears in the
// list. Mocked action + router (the createWorkPackage action + create_work_package
// RPC are the load-bearing validators; this covers the wiring).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ createWorkPackage: mockCreate }));

import { AddWorkPackageSheet } from "@/app/projects/[projectId]/add-work-package-sheet";

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true, id: "wp-1" });
  mockRefresh.mockReset();
});

function open() {
  render(<AddWorkPackageSheet projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มงาน/ }));
}

describe("AddWorkPackageSheet", () => {
  it("disables submit until both code and name are entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "สร้างงาน" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-001" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานวางท่อ" } });
    expect(submit).toBeEnabled();
  });

  it("creates the WP and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-001" } });
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานวางท่อ" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงาน" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        projectId: "p1",
        code: "WP-001",
        name: "งานวางท่อ",
        description: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "รหัสงานนี้มีอยู่แล้วในโครงการ" });
    open();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-001" } });
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานซ้ำ" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงาน" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("รหัสงานนี้มีอยู่แล้วในโครงการ"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
