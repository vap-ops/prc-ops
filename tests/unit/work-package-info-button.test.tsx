// Writing failing test first.
//
// Spec 94: the WP detail header is slimmed to code + name + status pill; the
// contractor block (display + reassign) and the read-only description move into a
// bottom sheet opened by an ⓘ chip. WorkPackageInfoButton owns the chip + sheet;
// the reassign control reuses WpAssignmentPanel (which imports the server action,
// mocked here).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/assignment-actions", () => ({
  setWorkPackageContractor: vi.fn().mockResolvedValue({ ok: true }),
  createContractor: vi.fn().mockResolvedValue({ ok: true, id: "c2" }),
}));
// Spec 363 U1: the sheet now renders WorkPackageNotes, which imports the notes
// server action directly.
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/notes-actions", () => ({
  setWorkPackageNotes: vi.fn().mockResolvedValue({ ok: true }),
}));

import { WorkPackageInfoButton } from "@/components/features/work-packages/work-package-info-button";

const PROPS = {
  projectId: "11111111-1111-1111-1111-111111111111",
  workPackageId: "22222222-2222-2222-2222-222222222222",
  contractor: { name: "ช่างรับเหมา ก", phone: "081-234-5678" },
  contractorId: "33333333-3333-3333-3333-333333333333",
  description: "รายละเอียดงานโครงสร้าง",
  isAssigner: true,
  contractors: [
    { id: "33333333-3333-3333-3333-333333333333", name: "ช่างรับเหมา ก", phone: "081-234-5678" },
  ],
  notes: "ระวังท่อน้ำใต้พื้น",
  canEditNotes: true,
};

describe("WorkPackageInfoButton", () => {
  it("renders the ⓘ trigger and keeps the info hidden until opened", () => {
    render(<WorkPackageInfoButton {...PROPS} />);
    expect(screen.getByRole("button", { name: "ข้อมูลงาน" })).toBeInTheDocument();
    expect(screen.queryByText("ช่างรับเหมา ก")).not.toBeInTheDocument();
  });

  it("opens the sheet with the contractor, phone link, description, and reassign control", () => {
    render(<WorkPackageInfoButton {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
    expect(screen.getByText("ช่างรับเหมา ก")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "081-234-5678" })).toHaveAttribute(
      "href",
      "tel:081-234-5678",
    );
    expect(screen.getByText("รายละเอียดงานโครงสร้าง")).toBeInTheDocument();
    // reassign trigger from WpAssignmentPanel (isAssigner + assigned)
    expect(screen.getByRole("button", { name: "มอบหมายงาน" })).toBeInTheDocument();
  });

  // Spec 363 U1 — หมายเหตุ moves out of the ข้อมูล tab into this sheet.
  it("shows the notes editor in the sheet for a viewer who may edit", () => {
    render(<WorkPackageInfoButton {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
    const field = screen.getByLabelText("หมายเหตุ");
    expect(field).toHaveValue("ระวังท่อน้ำใต้พื้น");
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("shows notes as read-only text when the viewer may not edit", () => {
    render(<WorkPackageInfoButton {...PROPS} canEditNotes={false} />);
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
    expect(screen.getByText("ระวังท่อน้ำใต้พื้น")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders an em dash for a read-only viewer when there are no notes", () => {
    render(<WorkPackageInfoButton {...PROPS} canEditNotes={false} notes={null} />);
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // D2: the ⓘ must render even when there is nothing else to show, or a bare WP
  // would have no route to its notes at all.
  it("renders the ⓘ trigger even with no contractor and no description", () => {
    render(
      <WorkPackageInfoButton {...PROPS} contractor={null} contractorId={null} description={null} />,
    );
    expect(screen.getByRole("button", { name: "ข้อมูลงาน" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
    expect(screen.getByLabelText("หมายเหตุ")).toBeInTheDocument();
  });
});
