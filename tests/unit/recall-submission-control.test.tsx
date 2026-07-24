// Writing failing test first.
//
// Spec 352 — the "ถอนงานกลับมาแก้ไข" control: the submitter pulls a submitted WP
// back out of review to fix its evidence. A button opens a confirm sheet (a
// status change should be deliberate); confirming calls
// recallWorkPackageSubmission and refreshes. Mocked action + router (the action
// + DB predicate carry the authority gates; the page only renders this control
// when canRecall is true).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecall, mockRefresh } = vi.hoisted(() => ({
  mockRecall: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  recallWorkPackageSubmission: mockRecall,
}));

import { RecallSubmissionControl } from "@/app/projects/[projectId]/work-packages/[workPackageId]/recall-submission-control";

beforeEach(() => {
  mockRecall.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("RecallSubmissionControl", () => {
  it("gates the recall behind a confirm sheet (no accidental one-tap recall)", () => {
    render(<RecallSubmissionControl projectId="p1" workPackageId="wp1" />);
    expect(screen.queryByRole("button", { name: "ถอนกลับมาแก้ไข" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ถอนงานกลับมาแก้ไข" }));
    expect(screen.getByRole("button", { name: "ถอนกลับมาแก้ไข" })).toBeInTheDocument();
  });

  it("recalls and refreshes on success", async () => {
    render(<RecallSubmissionControl projectId="p1" workPackageId="wp1" />);
    fireEvent.click(screen.getByRole("button", { name: "ถอนงานกลับมาแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ถอนกลับมาแก้ไข" }));
    await waitFor(() =>
      expect(mockRecall).toHaveBeenCalledWith({ projectId: "p1", workPackageId: "wp1" }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockRecall.mockResolvedValue({
      ok: false,
      error: "ถอนงานไม่ได้ (คุณไม่ใช่ผู้ส่งงานนี้ หรือสถานะเปลี่ยนไปแล้ว)",
    });
    render(<RecallSubmissionControl projectId="p1" workPackageId="wp1" />);
    fireEvent.click(screen.getByRole("button", { name: "ถอนงานกลับมาแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ถอนกลับมาแก้ไข" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("คุณไม่ใช่ผู้ส่งงานนี้"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
