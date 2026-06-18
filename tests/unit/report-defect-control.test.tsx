// Writing failing test first.
//
// Spec 144 U2 — the "report defect" control on a complete WP. SA/PM/super open
// it, give a reason, and the WP reopens to rework. Mocked action + router (the
// reopen_work_package_for_defect RPC carries the gates).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReport, mockRefresh } = vi.hoisted(() => ({
  mockReport: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  reportDefect: mockReport,
}));

import { ReportDefectControl } from "@/app/projects/[projectId]/work-packages/[workPackageId]/report-defect-control";

beforeEach(() => {
  mockReport.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<ReportDefectControl projectId="p1" workPackageId="wp1" />);
  fireEvent.click(screen.getByRole("button", { name: /รายงานข้อบกพร่อง/ }));
}

describe("ReportDefectControl", () => {
  it("disables submit until a reason is entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "เปิดงานใหม่" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าวที่ผนัง" },
    });
    expect(submit).toBeEnabled();
  });

  it("reopens with the reason and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าวที่ผนัง" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        reason: "รอยร้าวที่ผนัง",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockReport.mockResolvedValue({ ok: false, error: "เปิดงานใหม่ไม่สำเร็จ" });
    open();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "ปัญหา" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("เปิดงานใหม่ไม่สำเร็จ"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
