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

// Spec 270 U4 — an adopted project (has งาน rows) creates งานย่อย only, so the
// sheet requires a parent pick there; the DB (U6 forward guard) already rejects
// a parentless insert — this makes the UI ask instead of erroring. Legacy
// projects (no groups prop) keep the exact old form + payload.
describe("AddWorkPackageSheet parent pick (spec 270 U4)", () => {
  const GROUPS = [
    { id: "g-1", code: "WP-05", name: "งานหลังคา" },
    { id: "g-2", code: "WP-06", name: "งานผนัง" },
  ];

  function openAdopted() {
    render(<AddWorkPackageSheet projectId="p1" groups={GROUPS} />);
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มงาน/ }));
  }

  it("legacy project renders no parent select", () => {
    open();
    expect(screen.queryByLabelText(/อยู่ในงาน/)).not.toBeInTheDocument();
  });

  it("adopted project: submit stays disabled until a parent งาน is picked", () => {
    openAdopted();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-05-11" } });
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานย่อยใหม่" } });
    const submit = screen.getByRole("button", { name: "สร้างงาน" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/อยู่ในงาน/), { target: { value: "g-1" } });
    expect(submit).toBeEnabled();
  });

  it("adopted project: the picked parent rides the action payload", async () => {
    openAdopted();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-05-11" } });
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานย่อยใหม่" } });
    fireEvent.change(screen.getByLabelText(/อยู่ในงาน/), { target: { value: "g-2" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงาน" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        projectId: "p1",
        code: "WP-05-11",
        name: "งานย่อยใหม่",
        description: "",
        parentId: "g-2",
      }),
    );
  });
});
