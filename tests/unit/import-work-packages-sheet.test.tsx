// Writing failing test first.
//
// Spec 142 U7 — import work packages from CSV (paste). PM/super paste rows
// (code,name,description), the existing wp-import parser validates, valid rows
// are created. Mocked action + router (parser + create_work_package carry the
// real validation).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockImport, mockRefresh } = vi.hoisted(() => ({
  mockImport: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ importWorkPackagesCsv: mockImport }));

import { ImportWorkPackagesSheet } from "@/app/projects/[projectId]/import-work-packages-sheet";

const CSV = "code,name,description\nWP-1,งานหนึ่ง,\nWP-2,งานสอง,รายละเอียด";

beforeEach(() => {
  mockImport.mockReset().mockResolvedValue({ ok: true, inserted: 2 });
  mockRefresh.mockReset();
});

function open() {
  render(<ImportWorkPackagesSheet projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: /วางรายการงาน/ }));
}

describe("ImportWorkPackagesSheet", () => {
  it("disables submit until CSV text is entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "นำเข้า" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วางข้อมูลงาน"), { target: { value: CSV } });
    expect(submit).toBeEnabled();
  });

  it("imports the pasted CSV and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("วางข้อมูลงาน"), { target: { value: CSV } });
    fireEvent.click(screen.getByRole("button", { name: "นำเข้า" }));

    await waitFor(() => expect(mockImport).toHaveBeenCalledWith("p1", CSV));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockImport.mockResolvedValue({ ok: false, error: 'แถว 2: รหัส "WP-1" ซ้ำ' });
    open();
    fireEvent.change(screen.getByLabelText("วางข้อมูลงาน"), { target: { value: CSV } });
    fireEvent.click(screen.getByRole("button", { name: "นำเข้า" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent('แถว 2: รหัส "WP-1" ซ้ำ'),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
