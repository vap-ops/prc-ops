// Writing failing test first.
//
// Spec 272 — worker level + หัวหน้าช่าง badge on the roster. Surfacing only:
// the spec-161/ADR-0060 schema (workers.level, projects.ht_worker_id) finally
// gets its roster UI. Grade selector = super_admin only (canGrade); HT assign =
// PM_ROLES only (canAssignHt); the RPCs gate again server-side.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockSetRate, mockAssign, mockSetLevel, mockAssignHt, mockRefresh } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockSetRate: vi.fn(),
    mockAssign: vi.fn(),
    mockSetLevel: vi.fn(),
    mockAssignHt: vi.fn(),
    mockRefresh: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: mockCreate,
  updateWorker: mockUpdate,
  setWorkerDayRate: mockSetRate,
  assignWorkerToProject: mockAssign,
  setWorkerLevel: mockSetLevel,
  assignProjectHt: mockAssignHt,
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import {
  WorkerRosterManager,
  type AssignableProject,
  type ManagedWorker,
} from "@/components/features/labor/worker-roster-manager";

// A daily, active ช่าง on project p1 — the HT-eligible base case.
const DAILY: ManagedWorker = {
  id: "w1",
  name: "ช่างหนึ่ง",
  pay_type: "daily",
  contractor_id: null,
  day_rate: 500,
  active: true,
  note: null,
  employment_type: "permanent",
  portalBound: false,
  project_id: "p1",
  level: null,
  phone: null,
  tax_id: null,
  bank_name: null,
  bank_account_number: null,
  bank_account_name: null,
};

const P1: AssignableProject = {
  id: "p1",
  code: "PRC-2026-001",
  name: "บ้านคุณเอ",
  ht_worker_id: null,
};

function openEdit(name = "แก้ไข") {
  fireEvent.click(screen.getAllByRole("button", { name })[0]!);
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockAssign.mockReset().mockResolvedValue({ ok: true });
  mockSetLevel.mockReset().mockResolvedValue({ ok: true });
  mockAssignHt.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("spec 272 U1 — ระดับช่าง on the roster", () => {
  it("shows the level on a graded worker's row and nothing on an ungraded one", () => {
    render(
      <WorkerRosterManager
        workers={[
          { ...DAILY, level: "senior" },
          { ...DAILY, id: "w2", name: "ช่างสอง", level: null },
        ]}
        contractors={[]}
        projects={[P1]}
      />,
    );
    expect(screen.getByText(/ระดับอาวุโส/)).toBeInTheDocument();
    // exactly one graded row → exactly one ระดับ mention (sheets are closed).
    expect(screen.getAllByText(/ระดับ/)).toHaveLength(1);
  });

  it("shows the grade selector only when canGrade (super_admin)", () => {
    const { unmount } = render(
      <WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} canGrade />,
    );
    openEdit();
    expect(screen.getByLabelText("ระดับช่าง")).toBeInTheDocument();
    unmount();

    render(<WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} />);
    openEdit();
    expect(screen.queryByLabelText("ระดับช่าง")).not.toBeInTheDocument();
  });

  it("offers the ยังไม่ประเมิน placeholder only while ungraded", () => {
    const { unmount } = render(
      <WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} canGrade />,
    );
    openEdit();
    expect(screen.getByRole("option", { name: "ยังไม่ประเมิน" })).toBeInTheDocument();
    unmount();

    render(
      <WorkerRosterManager
        workers={[{ ...DAILY, level: "mid" }]}
        contractors={[]}
        projects={[P1]}
        canGrade
      />,
    );
    openEdit();
    // graded: no fake clear-to-null path (the RPC has none).
    expect(screen.queryByRole("option", { name: "ยังไม่ประเมิน" })).not.toBeInTheDocument();
  });

  it("saves a changed level through setWorkerLevel", async () => {
    render(<WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} canGrade />);
    openEdit();
    fireEvent.change(screen.getByLabelText("ระดับช่าง"), { target: { value: "senior" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockSetLevel).toHaveBeenCalledWith({ id: "w1", level: "senior" }));
  });

  it("does not call setWorkerLevel when the level is untouched", async () => {
    render(
      <WorkerRosterManager
        workers={[{ ...DAILY, level: "mid" }]}
        contractors={[]}
        projects={[P1]}
        canGrade
      />,
    );
    openEdit();
    const names = screen.getAllByLabelText("ชื่อ");
    fireEvent.change(names[names.length - 1]!, { target: { value: "ช่างหนึ่ง ใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockSetLevel).not.toHaveBeenCalled();
  });
});

describe("spec 272 U2 — หัวหน้าช่าง badge + assign", () => {
  it("badges the project's HT on their row", () => {
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[{ ...P1, ht_worker_id: "w1" }]}
      />,
    );
    expect(screen.getByText(/หัวหน้าช่าง PRC-2026-001/)).toBeInTheDocument();
  });

  it("assigns the worker as the project's HT from the edit sheet", async () => {
    render(<WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} canAssignHt />);
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: /ตั้งเป็นหัวหน้าช่าง/ }));
    await waitFor(() =>
      expect(mockAssignHt).toHaveBeenCalledWith({ projectId: "p1", workerId: "w1" }),
    );
  });

  it("warns whom the assignment will replace, by name", () => {
    render(
      <WorkerRosterManager
        workers={[DAILY, { ...DAILY, id: "w2", name: "ช่างสอง" }]}
        contractors={[]}
        projects={[{ ...P1, ht_worker_id: "w2" }]}
        canAssignHt
      />,
    );
    openEdit();
    expect(screen.getByText(/จะแทนที่: ช่างสอง/)).toBeInTheDocument();
  });

  it("shows a static line instead of the button when already this project's HT", () => {
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[{ ...P1, ht_worker_id: "w1" }]}
        canAssignHt
      />,
    );
    openEdit();
    expect(screen.getByText("หัวหน้าช่างของโครงการนี้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตั้งเป็นหัวหน้าช่าง/ })).not.toBeInTheDocument();
  });

  it("hints to assign a project first when the worker has none", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...DAILY, project_id: null }]}
        contractors={[]}
        projects={[P1]}
        canAssignHt
      />,
    );
    openEdit();
    expect(screen.getByText(/กำหนดโครงการก่อน/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตั้งเป็นหัวหน้าช่าง/ })).not.toBeInTheDocument();
  });

  it("still badges a monthly worker who is a project's HT (badge ≠ assign block)", () => {
    // Display truth is independent of the assign gate: the badge reads
    // projects.ht_worker_id even for a pay type the RPC would no longer accept.
    render(
      <WorkerRosterManager
        workers={[{ ...DAILY, pay_type: "monthly" }]}
        contractors={[]}
        projects={[{ ...P1, ht_worker_id: "w1" }]}
      />,
    );
    expect(screen.getByText(/หัวหน้าช่าง PRC-2026-001/)).toBeInTheDocument();
  });

  it("renders neither button nor hint when the assigned project is outside the visible list", () => {
    // A PM's RLS-scoped projects list may omit a worker's (non-member) project:
    // project_id is set but unresolvable → no dangling "— " button, no wrong
    // "assign a project first" hint.
    render(<WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[]} canAssignHt />);
    openEdit();
    expect(screen.queryByRole("button", { name: /ตั้งเป็นหัวหน้าช่าง/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/กำหนดโครงการก่อน/)).not.toBeInTheDocument();
  });

  it("renders no HT block for a monthly worker or without canAssignHt", () => {
    const { unmount } = render(
      <WorkerRosterManager
        workers={[{ ...DAILY, pay_type: "monthly" }]}
        contractors={[]}
        projects={[P1]}
        canAssignHt
      />,
    );
    openEdit();
    expect(screen.queryByText(/หัวหน้าช่าง/)).not.toBeInTheDocument();
    unmount();

    render(<WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} />);
    openEdit();
    expect(screen.queryByRole("button", { name: /ตั้งเป็นหัวหน้าช่าง/ })).not.toBeInTheDocument();
  });
});
