// Writing failing test first.
//
// Spec 164 U3 — bulk-assign ungrouped งาน to a งวด. PM/super/director pick a
// target งวด and check the งาน to move; the assignWorkPackagesToDeliverable
// action (loops set_work_package_deliverable) is the load-bearing path.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssign, mockRefresh } = vi.hoisted(() => ({
  mockAssign: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({
  assignWorkPackagesToDeliverable: mockAssign,
}));

import { GroupWorkPackagesSheet } from "@/app/projects/[projectId]/group-work-packages-sheet";

const UNGROUPED = [
  { id: "11111111-1111-1111-1111-111111111111", code: "WP-1", name: "งานหนึ่ง" },
  { id: "22222222-2222-2222-2222-222222222222", code: "WP-2", name: "งานสอง" },
];
const DELIVERABLES = [
  { id: "d1111111-1111-1111-1111-111111111111", code: "D01", name: "งวดหนึ่ง" },
];

beforeEach(() => {
  mockAssign.mockReset().mockResolvedValue({ ok: true, count: 2 });
  mockRefresh.mockReset();
});

function open() {
  render(
    <GroupWorkPackagesSheet
      projectId="p1"
      ungroupedWorkPackages={UNGROUPED}
      deliverables={DELIVERABLES}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /จัดกลุ่ม/ }));
}

describe("GroupWorkPackagesSheet", () => {
  it("disables the move button until a งวด and at least one งาน are chosen", () => {
    open();
    const move = screen.getByRole("button", { name: /ย้าย/ });
    expect(move).toBeDisabled();

    fireEvent.change(screen.getByLabelText("เลือกงวดปลายทาง"), {
      target: { value: "d1111111-1111-1111-1111-111111111111" },
    });
    expect(move).toBeDisabled(); // งวด chosen, no งาน yet

    fireEvent.click(screen.getByLabelText("WP-1 งานหนึ่ง"));
    expect(move).toBeEnabled();
  });

  it("assigns the checked งาน to the chosen งวด and refreshes", async () => {
    open();
    fireEvent.change(screen.getByLabelText("เลือกงวดปลายทาง"), {
      target: { value: "d1111111-1111-1111-1111-111111111111" },
    });
    fireEvent.click(screen.getByLabelText("WP-1 งานหนึ่ง"));
    fireEvent.click(screen.getByLabelText("WP-2 งานสอง"));
    fireEvent.click(screen.getByRole("button", { name: /ย้าย/ }));

    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledWith(
        "p1",
        ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
        "d1111111-1111-1111-1111-111111111111",
      ),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("select-all checks every งาน", () => {
    open();
    fireEvent.change(screen.getByLabelText("เลือกงวดปลายทาง"), {
      target: { value: "d1111111-1111-1111-1111-111111111111" },
    });
    fireEvent.click(screen.getByLabelText("เลือกทั้งหมด"));
    expect(screen.getByLabelText("WP-1 งานหนึ่ง")).toBeChecked();
    expect(screen.getByLabelText("WP-2 งานสอง")).toBeChecked();
    expect(screen.getByRole("button", { name: /ย้าย/ })).toBeEnabled();
  });

  it("shows the action error inline and does not refresh", async () => {
    mockAssign.mockResolvedValue({ ok: false, error: "ย้ายงานไม่สำเร็จ" });
    open();
    fireEvent.change(screen.getByLabelText("เลือกงวดปลายทาง"), {
      target: { value: "d1111111-1111-1111-1111-111111111111" },
    });
    fireEvent.click(screen.getByLabelText("WP-1 งานหนึ่ง"));
    fireEvent.click(screen.getByRole("button", { name: /ย้าย/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ย้ายงานไม่สำเร็จ"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
