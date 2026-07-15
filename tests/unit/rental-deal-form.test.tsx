// Writing failing test first.
//
// Spec 323 U1c — RentalDealForm extracted from RentalManager's record section so
// it can be hosted in a bottom sheet (operator: forms off the list, into sheets).
// Same deal fields (owner · rate + ต่อเดือน/ต่อวัน · duration ตลอดโครงการ /
// กำหนดช่วงเอง · deposit · min-days · optional project · note); on a clean save it
// calls createRentalBatch, refreshes, then onDone() to close the sheet. The
// project-locked variant (project page) hides the โครงการ pick and forces the
// binding. Mocked actions + router.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateBatch, mockRefresh } = vi.hoisted(() => ({
  mockCreateBatch: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  createRentalBatch: mockCreateBatch,
}));

import {
  EQUIPMENT_RENTAL_PARTIAL_LOCKED_MESSAGE,
  RentalDealForm,
} from "@/components/features/equipment/rental-deal-form";

const suppliers = [
  { id: "o1", name: "บ.เครนไทย" },
  { id: "o2", name: "บ.นั่งร้านสยาม" },
];
const projects = [{ id: "p1", name: "โครงการ A" }];

function renderForm(props: Partial<React.ComponentProps<typeof RentalDealForm>> = {}) {
  return render(
    <RentalDealForm
      suppliers={suppliers}
      projects={projects}
      defaultDate="2026-07-05"
      {...props}
    />,
  );
}

describe("RentalDealForm", () => {
  beforeEach(() => {
    mockCreateBatch.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("defaults to monthly rate + whole-project duration (no end-date input)", () => {
    renderForm();
    expect(screen.getByRole("radio", { name: "ต่อเดือน" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ตลอดโครงการ" })).toBeChecked();
    expect(screen.queryByLabelText("วันสิ้นสุด")).not.toBeInTheDocument();
  });

  it("reveals the end-date input for a custom duration", () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "กำหนดช่วงเอง" }));
    expect(screen.getByLabelText("วันสิ้นสุด")).toBeInTheDocument();
  });

  it("groups previously-rented vendors above the full list", () => {
    renderForm({ suggestedSupplierIds: ["o2"] });
    const suggested = screen.getByRole("group", { name: "เคยให้เช่า" });
    expect(within(suggested).getByRole("option", { name: "บ.นั่งร้านสยาม" })).toBeInTheDocument();
    const all = screen.getByRole("group", { name: "ผู้ให้เช่าทั้งหมด" });
    expect(within(all).getByRole("option", { name: "บ.เครนไทย" })).toBeInTheDocument();
  });

  it("submits a monthly whole-project rental, refreshes, then closes via onDone", async () => {
    const onDone = vi.fn();
    renderForm({ onDone });
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
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("submits a daily custom-duration rental bound to a project", async () => {
    renderForm();
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

  it("rejects a missing owner client-side and does not close", async () => {
    const onDone = vi.fn();
    renderForm({ onDone });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockCreateBatch).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("hides the project select and auto-allocates to the locked project on record", async () => {
    renderForm({ lockedProject: { id: "p1", name: "โครงการ A" } });
    expect(screen.queryByLabelText("โครงการ")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("เช่าจาก"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    await waitFor(() =>
      expect(mockCreateBatch).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" })),
    );
  });

  it("on the locked surface, a partial failure points recovery at the settings overview", async () => {
    mockCreateBatch.mockResolvedValue({
      ok: false,
      error: "บันทึกการเช่าแล้ว แต่ผูกโครงการไม่สำเร็จ — กดผูกโครงการที่รายการอีกครั้ง",
      code: "allocation_failed",
    });
    const onDone = vi.fn();
    renderForm({ lockedProject: { id: "p1", name: "โครงการ A" }, onDone });
    fireEvent.change(screen.getByLabelText("เช่าจาก"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText(/ค่าเช่า/), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการเช่า" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(EQUIPMENT_RENTAL_PARTIAL_LOCKED_MESSAGE);
    expect(alert).not.toHaveTextContent("ที่รายการ");
    expect(onDone).not.toHaveBeenCalled();
  });
});
