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
const GROUPS = [
  { id: "g-1", code: "WP-05", name: "งานหลังคา" },
  { id: "g-2", code: "WP-06", name: "งานผนัง" },
];

describe("AddWorkPackageSheet parent pick (spec 270 U4)", () => {
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

// Spec 335 — opened from the งาน detail the parent is already known, so the
// select is replaced by static context and the whole sheet speaks งานย่อย.
describe("AddWorkPackageSheet fixed parent (spec 335)", () => {
  const PARENT = { id: "g-1", code: "WP-05", name: "งานหลังคา" };

  // Rendered WITH groups on purpose: a fixed parent must WIN over the picker,
  // and passing only fixedParent would leave that precedence asserted by nothing.
  function openFixed() {
    render(<AddWorkPackageSheet projectId="p1" groups={GROUPS} fixedParent={PARENT} />);
    fireEvent.click(screen.getByRole("button", { name: "+ เพิ่มงานย่อย" }));
  }

  it("replaces the parent select with static context, even when groups are supplied", () => {
    openFixed();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/อยู่ในงาน WP-05 งานหลังคา/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "เพิ่มงานย่อย" })).toBeInTheDocument();
  });

  it("keeps submit disabled while the code is still the bare parent prefix", () => {
    openFixed();
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานย่อยใหม่" } });
    const submit = screen.getByRole("button", { name: "สร้างงานย่อย" });
    // The prefill is a head start, not a code — WP-05- alone passes the
    // non-empty validator, so the sheet has to reject it itself.
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-05-11" } });
    expect(submit).toBeEnabled();
  });

  it("prefills the code with the parent's code prefix (331/331 live children follow it)", () => {
    openFixed();
    expect(screen.getByLabelText("รหัสงาน")).toHaveValue("WP-05-");
  });

  it("submits with the viewed งาน as parentId", async () => {
    openFixed();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-05-11" } });
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานย่อยใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงานย่อย" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        projectId: "p1",
        code: "WP-05-11",
        name: "งานย่อยใหม่",
        description: "",
        parentId: "g-1",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("resets the code back to the parent prefix after a successful create", async () => {
    openFixed();
    fireEvent.change(screen.getByLabelText("รหัสงาน"), { target: { value: "WP-05-11" } });
    fireEvent.change(screen.getByLabelText("ชื่องาน"), { target: { value: "งานย่อยใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างงานย่อย" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ เพิ่มงานย่อย" }));
    expect(screen.getByLabelText("รหัสงาน")).toHaveValue("WP-05-");
  });
});
