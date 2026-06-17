// Writing failing test first.
//
// Spec 75: the worker roster gains a note field — on the add form and the
// per-row edit block — and shows a worker's note on its row.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockSetRate, mockRefresh, mockToastError } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSetRate: vi.fn(),
  mockRefresh: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: mockCreate,
  updateWorker: mockUpdate,
  setWorkerDayRate: mockSetRate,
}));
// Spec 139: the optimistic toggle surfaces a failed flip via toast.error.
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: mockToastError,
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import {
  WorkerRosterManager,
  type ManagedWorker,
} from "@/components/features/labor/worker-roster-manager";

const WORKERS: ManagedWorker[] = [
  {
    id: "w1",
    name: "ช่างหนึ่ง",
    worker_type: "own",
    contractor_id: null,
    day_rate: 500,
    active: true,
    note: "หัวหน้าทีม",
  },
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockToastError.mockReset();
});

describe("WorkerRosterManager notes", () => {
  it("shows a worker's note on the row", () => {
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);
    expect(screen.getByText(/หัวหน้าทีม/)).toBeInTheDocument();
  });

  it("passes the note when adding a worker", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "คนใหม่" } });
    fireEvent.change(screen.getByLabelText("ค่าแรงต่อวัน (บาท)"), { target: { value: "450" } });
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "ทดลองงาน" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มทีมงาน" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ note: "ทดลองงาน" })),
    );
  });

  it("DC parent picker shows only non-blacklisted DC crews (spec 89)", () => {
    render(
      <WorkerRosterManager
        workers={[]}
        contractors={[
          { id: "a", name: "DC ใช้งาน", status: "active", contractor_category: "dc" },
          { id: "b", name: "DC บัญชีดำ", status: "blacklisted", contractor_category: "dc" },
          {
            id: "c",
            name: "ผู้รับเหมาทั่วไป",
            status: "active",
            contractor_category: "contractor",
          },
        ]}
      />,
    );
    // Reveal the DC-parent picker by switching the add-form worker type to DC.
    fireEvent.click(screen.getByRole("radio", { name: "ทีมงาน DC" }));
    expect(screen.getByRole("option", { name: "DC ใช้งาน" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "DC บัญชีดำ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "ผู้รับเหมาทั่วไป" })).not.toBeInTheDocument();
  });

  it("passes the note when editing a worker", async () => {
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    // [0] is the add-form note, [1] is the editing row's note.
    const noteFields = screen.getAllByLabelText("หมายเหตุ");
    fireEvent.change(noteFields[1]!, { target: { value: "เลื่อนเป็นโฟร์แมน" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "w1", note: "เลื่อนเป็นโฟร์แมน" }),
      ),
    );
  });
});

// Spec 139 (app-feel slice 3) — the active-toggle is optimistic: it flips on tap,
// commits on success without a router.refresh, and rolls back + toasts on error.
describe("WorkerRosterManager optimistic active-toggle", () => {
  it("flips the toggle optimistically before the server responds (no router.refresh)", async () => {
    let resolveUpdate!: (v: { ok: true } | { ok: false; error: string }) => void;
    mockUpdate.mockReset().mockImplementation(
      () =>
        new Promise((res) => {
          resolveUpdate = res;
        }),
    );
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));

    // Optimistic: the label flips + the inactive status suffix appears immediately,
    // while the action is still pending; the toggle does NOT router.refresh.
    expect(await screen.findByRole("button", { name: "เปิดใช้งาน" })).toBeInTheDocument();
    expect(screen.getByText(/\(ปิดใช้งาน\)/)).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledWith({ id: "w1", active: false });
    expect(mockRefresh).not.toHaveBeenCalled();

    resolveUpdate({ ok: true });
    // Commit: still flipped after the transition settles.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "เปิดใช้งาน" })).toBeInTheDocument(),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("rolls back the flip and toasts on a failed toggle", async () => {
    mockUpdate.mockReset().mockResolvedValue({ ok: false, error: "ปรับสถานะไม่สำเร็จ" });
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("ปรับสถานะไม่สำเร็จ"));
    // Reverted: button back to ปิดใช้งาน, the inactive suffix gone, no refresh.
    expect(screen.getByRole("button", { name: "ปิดใช้งาน" })).toBeInTheDocument();
    expect(screen.queryByText(/\(ปิดใช้งาน\)/)).not.toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
