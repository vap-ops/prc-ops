// Writing failing test first.
//
// Spec 142 U6 — copy work packages from another project. PM/super pick a source
// project (only ones they can see — RLS-scoped) and the skeleton is cloned in.
// Mocked action + router (clone_work_packages RPC carries DB correctness).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCopy, mockRefresh } = vi.hoisted(() => ({
  mockCopy: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ copyWorkPackages: mockCopy }));

import { CopyWorkPackagesSheet } from "@/app/projects/[projectId]/copy-work-packages-sheet";

const SOURCES = [
  { id: "src1", code: "PRC-A", name: "โครงการเอ" },
  { id: "src2", code: "PRC-B", name: "โครงการบี" },
];

beforeEach(() => {
  mockCopy.mockReset().mockResolvedValue({ ok: true, count: 3 });
  mockRefresh.mockReset();
});

function open() {
  render(<CopyWorkPackagesSheet projectId="dst" sourceProjects={SOURCES} />);
  fireEvent.click(screen.getByRole("button", { name: /คัดลอกงาน/ }));
}

describe("CopyWorkPackagesSheet", () => {
  it("disables submit until a source project is chosen", () => {
    open();
    const submit = screen.getByRole("button", { name: "คัดลอก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("โครงการต้นทาง"), { target: { value: "src1" } });
    expect(submit).toBeEnabled();
  });

  it("clones from the chosen source and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("โครงการต้นทาง"), { target: { value: "src2" } });
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก" }));

    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith("src2", "dst"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockCopy.mockResolvedValue({ ok: false, error: "คัดลอกไม่สำเร็จ" });
    open();
    fireEvent.change(screen.getByLabelText("โครงการต้นทาง"), { target: { value: "src1" } });
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("คัดลอกไม่สำเร็จ"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
