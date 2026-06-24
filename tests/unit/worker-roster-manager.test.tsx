// Writing failing test first.
//
// Spec 75: the worker roster gains a note field — on the add form and the
// per-row edit block — and shows a worker's note on its row.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockSetRate, mockAssign, mockRefresh, mockToastError } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockSetRate: vi.fn(),
    mockAssign: vi.fn(),
    mockRefresh: vi.fn(),
    mockToastError: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: mockCreate,
  updateWorker: mockUpdate,
  setWorkerDayRate: mockSetRate,
  assignWorkerToProject: mockAssign,
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
    dc_arrangement: null,
    portalBound: false,
    project_id: null,
  },
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockAssign.mockReset().mockResolvedValue({ ok: true });
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

  // ADR 0062 U1 — a DC is a self-sufficient worker: switching to DC reveals the
  // arrangement (ประจำ/ชั่วคราว) + payee fields, and the old ผู้รับเหมา parent
  // picker is gone (DC is hired directly, never from a firm).
  it("DC add form shows arrangement + payee fields, no contractor picker", () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    expect(screen.queryByRole("radio", { name: "ประจำ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "ทีมงาน DC" }));
    expect(screen.getByRole("radio", { name: "ประจำ" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ชั่วคราว" })).toBeInTheDocument();
    expect(screen.getByLabelText("เลขบัญชีธนาคาร")).toBeInTheDocument();
    expect(screen.queryByLabelText("ผู้รับเหมา")).not.toBeInTheDocument();
  });

  it("adds a DC worker with arrangement + bank, no contractor", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: "ทีมงาน DC" }));
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "DC ตรง" } });
    fireEvent.change(screen.getByLabelText("ค่าแรงต่อวัน (บาท)"), { target: { value: "420" } });
    fireEvent.click(screen.getByRole("radio", { name: "ชั่วคราว" }));
    fireEvent.change(screen.getByLabelText("เลขบัญชีธนาคาร"), {
      target: { value: "1234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มทีมงาน" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "DC ตรง",
          workerType: "dc",
          dayRate: 420,
          arrangement: "temporary",
          bankAccountNumber: "1234567890",
        }),
      ),
    );
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

// A worker is assigned to one project at a time (workers.project_id). The roster
// surfaces the current project and lets the assigner move it.
describe("WorkerRosterManager project assignment", () => {
  const PROJECTS = [
    { id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" },
    { id: "p2", code: "PRC-2026-002", name: "อาคารบี" },
  ];

  it("shows the worker's current project on the row", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...WORKERS[0]!, project_id: "p1" }]}
        contractors={[]}
        projects={PROJECTS}
      />,
    );
    // the row's current-project line (the add form's <option> also names it)
    expect(screen.getByText(/โครงการ: PRC-2026-001/)).toBeInTheDocument();
  });

  it("assigns the worker to the chosen project on save", async () => {
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} projects={PROJECTS} />);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    // the edit sheet's project select (the add form has one too — take the last)
    const sels = screen.getAllByLabelText("โครงการ");
    fireEvent.change(sels[sels.length - 1]!, { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledWith({ workerId: "w1", projectId: "p2" }),
    );
  });

  it("creates a new worker already on the chosen project", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} projects={PROJECTS} />);
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "ช่างใหม่" } });
    fireEvent.change(screen.getByLabelText("ค่าแรงต่อวัน (บาท)"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มทีมงาน" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ช่างใหม่", projectId: "p2" }),
      ),
    );
  });

  it("does not call assign when the project is unchanged", async () => {
    render(
      <WorkerRosterManager
        workers={[{ ...WORKERS[0]!, project_id: "p1" }]}
        contractors={[]}
        projects={PROJECTS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    // change only the name (the edit sheet's, not the add form's), project stays p1
    const names = screen.getAllByLabelText("ชื่อ");
    fireEvent.change(names[names.length - 1]!, { target: { value: "ช่างใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockAssign).not.toHaveBeenCalled();
  });
});
