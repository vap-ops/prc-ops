// Writing failing test first.
//
// Spec 268 — RentalManager on /equipment/rentals (BACK_OFFICE money audience
// only; the page never renders it for a field session). One form records the
// deal: owner · rate + ต่อเดือน/ต่อวัน chips · duration ตลอดโครงการ (no end
// date) / กำหนดช่วงเอง (start+end) · optional project (allocate-on-create).
// Cards list recorded rentals; ผูกโครงการ opens the per-card allocation form.
// Mocked actions + router.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateBatch, mockCreateAllocation, mockRefresh } = vi.hoisted(() => ({
  mockCreateBatch: vi.fn(),
  mockCreateAllocation: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  createRentalBatch: mockCreateBatch,
  createRentalAllocation: mockCreateAllocation,
}));

import { RentalManager } from "@/components/features/equipment/rental-manager";

const suppliers = [
  { id: "o1", name: "บ.เครนไทย" },
  { id: "o2", name: "บ.นั่งร้านสยาม" },
];
const projects = [{ id: "p1", name: "โครงการ A" }];
const rentals = [
  {
    id: "b1",
    supplierName: "บ.เครนไทย",
    rateLabel: "฿90,000.00/เดือน",
    periodLabel: "เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ (จนกว่าจะคืน)",
    note: null,
    allocations: [{ id: "a1", projectName: "โครงการ A", periodLabel: "ตลอดโครงการ" }],
  },
];

function renderManager(cards = rentals) {
  return render(
    <RentalManager
      suppliers={suppliers}
      projects={projects}
      rentals={cards}
      defaultDate="2026-07-05"
    />,
  );
}

describe("RentalManager", () => {
  beforeEach(() => {
    mockCreateBatch.mockReset();
    mockCreateAllocation.mockReset();
    mockRefresh.mockReset();
    mockCreateBatch.mockResolvedValue({ ok: true });
    mockCreateAllocation.mockResolvedValue({ ok: true });
  });

  it("defaults to monthly rate + whole-project duration (no end-date input)", () => {
    renderManager();
    expect(screen.getByRole("radio", { name: "ต่อเดือน" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ตลอดโครงการ" })).toBeChecked();
    expect(screen.queryByLabelText("วันสิ้นสุด")).not.toBeInTheDocument();
  });

  it("reveals the end-date input for a custom duration", () => {
    renderManager();
    fireEvent.click(screen.getByRole("radio", { name: "กำหนดช่วงเอง" }));
    expect(screen.getByLabelText("วันสิ้นสุด")).toBeInTheDocument();
  });

  it("submits a monthly whole-project rental with no project binding", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText("เช่าจาก"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() =>
      expect(mockCreateBatch).toHaveBeenCalledWith({
        supplierId: "o1",
        rate: 90000,
        ratePeriod: "monthly",
        startsOn: "2026-07-05",
        endsOn: null,
        note: "",
        projectId: null,
        depositAmount: 0,
        minRentalDays: null,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("submits a daily custom-duration rental bound to a project", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText("เช่าจาก"), { target: { value: "o2" } });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "3500" } });
    fireEvent.click(screen.getByRole("radio", { name: "ต่อวัน" }));
    fireEvent.click(screen.getByRole("radio", { name: "กำหนดช่วงเอง" }));
    fireEvent.change(screen.getByLabelText("วันเริ่ม"), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText("วันสิ้นสุด"), { target: { value: "2026-07-20" } });
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() =>
      expect(mockCreateBatch).toHaveBeenCalledWith({
        supplierId: "o2",
        rate: 3500,
        ratePeriod: "daily",
        startsOn: "2026-07-10",
        endsOn: "2026-07-20",
        note: "",
        projectId: "p1",
        depositAmount: 0,
        minRentalDays: null,
      }),
    );
  });

  it("rejects a missing owner client-side before calling the action", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it("renders rental cards with rate, period, and allocation chips", () => {
    renderManager();
    // Scope to the list section — the owner/project names also exist as
    // <option>s inside the record form's selects.
    const list = within(screen.getByRole("region", { name: "รายการเช่า" }));
    expect(list.getByText("บ.เครนไทย")).toBeInTheDocument();
    expect(list.getByText("฿90,000.00/เดือน")).toBeInTheDocument();
    expect(list.getByText(/โครงการ A ·/)).toBeInTheDocument();
  });

  it("allocates an existing rental to a project from its card", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "ผูกโครงการ" }));
    fireEvent.change(screen.getByLabelText("โครงการที่ผูก"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("วันเริ่มผูก"), { target: { value: "2026-07-06" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันผูกโครงการ" }));
    await waitFor(() =>
      expect(mockCreateAllocation).toHaveBeenCalledWith({
        batchId: "b1",
        projectId: "p1",
        startsOn: "2026-07-06",
        endsOn: null,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows an empty state when nothing is recorded yet", () => {
    renderManager([]);
    expect(screen.getByText(/ยังไม่มีการเช่า/)).toBeInTheDocument();
  });

  // Spec 275 U5 — project-locked recorder (surfaced on /projects/[id]/rentals).
  // The project is fixed to this page, so the โครงการ pick is hidden and every
  // recorded rental auto-allocates to lockedProject.

  it("hides the project select and auto-allocates to the locked project on record", async () => {
    render(
      <RentalManager
        suppliers={suppliers}
        projects={projects}
        rentals={[]}
        defaultDate="2026-07-05"
        lockedProject={{ id: "p1", name: "โครงการ A" }}
      />,
    );
    expect(screen.queryByLabelText("โครงการ")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("เช่าจาก"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() =>
      expect(mockCreateBatch).toHaveBeenCalledWith({
        supplierId: "o1",
        rate: 90000,
        ratePeriod: "monthly",
        startsOn: "2026-07-05",
        endsOn: null,
        note: "",
        projectId: "p1",
        depositAmount: 0,
        minRentalDays: null,
      }),
    );
  });

  it("hides the per-card ผูกโครงการ re-allocate control when project-locked", () => {
    render(
      <RentalManager
        suppliers={suppliers}
        projects={projects}
        rentals={rentals}
        defaultDate="2026-07-05"
        lockedProject={{ id: "p1", name: "โครงการ A" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "ผูกโครงการ" })).not.toBeInTheDocument();
  });
});
