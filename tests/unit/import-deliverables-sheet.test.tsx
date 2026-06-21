// Writing failing test first.
//
// Spec 164 U2 — bulk-paste a งวด list on the project page. PM/super/director
// paste `D01<tab>name` rows (from the separate งวด tab); the importDeliverables
// action (spec-163 parser + create_deliverable RPC) is the load-bearing path.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockImport, mockRefresh } = vi.hoisted(() => ({
  mockImport: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ importDeliverables: mockImport }));

import { ImportDeliverablesSheet } from "@/app/projects/[projectId]/import-deliverables-sheet";

const LIST = "D01\tงานเตรียมพื้นที่\nD05\tงานโครงสร้าง";

beforeEach(() => {
  mockImport.mockReset().mockResolvedValue({ ok: true, inserted: 2 });
  mockRefresh.mockReset();
});

function open() {
  render(<ImportDeliverablesSheet projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: /วางรายการงวด/ }));
}

describe("ImportDeliverablesSheet", () => {
  it("disables submit until text is entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "นำเข้า" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วางข้อมูลงวด"), { target: { value: LIST } });
    expect(submit).toBeEnabled();
  });

  it("imports the pasted list and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("วางข้อมูลงวด"), { target: { value: LIST } });
    fireEvent.click(screen.getByRole("button", { name: "นำเข้า" }));

    await waitFor(() => expect(mockImport).toHaveBeenCalledWith("p1", LIST));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockImport.mockResolvedValue({
      ok: false,
      error: 'Row 2: duplicate code "D01" within the file',
    });
    open();
    fireEvent.change(screen.getByLabelText("วางข้อมูลงวด"), { target: { value: LIST } });
    fireEvent.click(screen.getByRole("button", { name: "นำเข้า" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent('duplicate code "D01"'),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
