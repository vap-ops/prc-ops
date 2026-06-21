// Writing failing test first.
//
// Spec 165 U4 — remove (ungroup) งาน from a งวด, so the งวด can be emptied and
// deleted. The removeWorkPackagesFromDeliverable action loops
// set_work_package_deliverable(…, null). Mirrors GroupWorkPackagesSheet.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRemove, mockRefresh } = vi.hoisted(() => ({
  mockRemove: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({
  removeWorkPackagesFromDeliverable: mockRemove,
}));

import { RemoveWorkPackagesSheet } from "@/app/projects/[projectId]/remove-work-packages-sheet";

const WPS = [
  { id: "11111111-1111-1111-1111-111111111111", code: "WP-1", name: "งานหนึ่ง" },
  { id: "22222222-2222-2222-2222-222222222222", code: "WP-2", name: "งานสอง" },
];

beforeEach(() => {
  mockRemove.mockReset().mockResolvedValue({ ok: true, count: 2 });
  mockRefresh.mockReset();
});

function open() {
  render(<RemoveWorkPackagesSheet projectId="p1" workPackages={WPS} />);
  fireEvent.click(screen.getByRole("button", { name: /เอางานออกจากงวด/ }));
}

describe("RemoveWorkPackagesSheet", () => {
  it("disables remove until at least one งาน is checked", () => {
    open();
    const remove = screen.getByRole("button", { name: /เอาออก/ });
    expect(remove).toBeDisabled();
    fireEvent.click(screen.getByLabelText("WP-1 งานหนึ่ง"));
    expect(remove).toBeEnabled();
  });

  it("ungroups the checked งาน and refreshes", async () => {
    open();
    fireEvent.click(screen.getByLabelText("WP-1 งานหนึ่ง"));
    fireEvent.click(screen.getByLabelText("WP-2 งานสอง"));
    fireEvent.click(screen.getByRole("button", { name: /เอาออก/ }));

    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith("p1", [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ]),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockRemove.mockResolvedValue({ ok: false, error: "เอางานออกไม่สำเร็จ" });
    open();
    fireEvent.click(screen.getByLabelText("WP-1 งานหนึ่ง"));
    fireEvent.click(screen.getByRole("button", { name: /เอาออก/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("เอางานออกไม่สำเร็จ"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
