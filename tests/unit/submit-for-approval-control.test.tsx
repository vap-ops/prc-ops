// Writing failing test first.
//
// FB2 (b9e942f0): the SA explicitly submits a finished WP for approval — this
// replaces the old auto-flip that fired on the first "after" photo (which sent
// partly-done WPs to review early). The control is a button that opens a confirm
// sheet; confirming flips status via submitWorkPackageForApproval. Mocked action
// + router (the action carries the role/membership gates).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSubmit, mockRefresh } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  submitWorkPackageForApproval: mockSubmit,
}));

import { SubmitForApprovalControl } from "@/app/projects/[projectId]/work-packages/[workPackageId]/submit-for-approval-control";

beforeEach(() => {
  mockSubmit.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("SubmitForApprovalControl", () => {
  it("gates the submit behind a confirm sheet (no accidental one-tap submit)", () => {
    render(<SubmitForApprovalControl projectId="p1" workPackageId="wp1" />);
    // The actual submit lives in the sheet — not reachable until the SA opens it.
    expect(screen.queryByRole("button", { name: "ส่งเข้าตรวจ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ส่งงานเข้าตรวจ" }));
    expect(screen.getByRole("button", { name: "ส่งเข้าตรวจ" })).toBeInTheDocument();
  });

  it("submits for approval and refreshes on success", async () => {
    render(<SubmitForApprovalControl projectId="p1" workPackageId="wp1" />);
    fireEvent.click(screen.getByRole("button", { name: "ส่งงานเข้าตรวจ" }));
    fireEvent.click(screen.getByRole("button", { name: "ส่งเข้าตรวจ" }));
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith({ projectId: "p1", workPackageId: "wp1" }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockSubmit.mockResolvedValue({ ok: false, error: "ส่งงานเข้าตรวจไม่สำเร็จ" });
    render(<SubmitForApprovalControl projectId="p1" workPackageId="wp1" />);
    fireEvent.click(screen.getByRole("button", { name: "ส่งงานเข้าตรวจ" }));
    fireEvent.click(screen.getByRole("button", { name: "ส่งเข้าตรวจ" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("ส่งงานเข้าตรวจไม่สำเร็จ"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
