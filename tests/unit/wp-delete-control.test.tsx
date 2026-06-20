// Spec 157: the WP delete control confirms, then deletes. On success it navigates
// to the project page; when the RPC refuses (WP has history), the action's
// "cancel instead" message renders inline and no navigation happens.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

type DeleteInput = { projectId: string; workPackageId: string };
type DeleteResult = { ok: true } | { ok: false; error: string };
const deleteWorkPackage = vi.fn<(input: DeleteInput) => Promise<DeleteResult>>();
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/delete-actions", () => ({
  deleteWorkPackage: (input: DeleteInput) => deleteWorkPackage(input),
}));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { WpDeleteControl } from "@/components/features/work-packages/wp-delete-control";

describe("WpDeleteControl", () => {
  beforeEach(() => {
    deleteWorkPackage.mockReset();
    push.mockClear();
    refresh.mockClear();
  });

  it("confirms then deletes and navigates to the project page", async () => {
    deleteWorkPackage.mockResolvedValue({ ok: true });
    render(<WpDeleteControl projectId="p1" workPackageId="w1" />);
    fireEvent.click(screen.getByRole("button", { name: "ลบงาน" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบถาวร" }));
    await waitFor(() =>
      expect(deleteWorkPackage).toHaveBeenCalledWith({ projectId: "p1", workPackageId: "w1" }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
  });

  it("shows the error inline and does not navigate when the WP has history", async () => {
    deleteWorkPackage.mockResolvedValue({ ok: false, error: "ลบไม่ได้ — มีประวัติ" });
    render(<WpDeleteControl projectId="p1" workPackageId="w1" />);
    fireEvent.click(screen.getByRole("button", { name: "ลบงาน" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบถาวร" }));
    expect(await screen.findByText("ลบไม่ได้ — มีประวัติ")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
