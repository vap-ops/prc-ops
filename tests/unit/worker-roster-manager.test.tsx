// Writing failing test first.
//
// Spec 75: the worker roster gains a note field — on the add form and the
// per-row edit block — and shows a worker's note on its row.
//
// Spec 266 U3 (ADR 0073) — DC→ช่าง merge: the add form now speaks in two
// ORTHOGONAL selectors — การจ่าย (pay_type) × สถานะ (employment_type) — instead
// of the old own/DC radio + DC-only arrangement. day_rate + payee gate on daily.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreate,
  mockUpdate,
  mockSetRate,
  mockAssign,
  mockRefresh,
  mockToastError,
  mockFriction,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSetRate: vi.fn(),
  mockAssign: vi.fn(),
  mockRefresh: vi.fn(),
  mockToastError: vi.fn(),
  mockFriction: vi.fn(),
}));

vi.mock("@/lib/telemetry/friction", () => ({ trackFriction: mockFriction }));

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
    pay_type: "monthly",
    contractor_id: null,
    day_rate: 500,
    active: true,
    note: "หัวหน้าทีม",
    employment_type: "permanent",
    portalBound: false,
    boundUserName: null,
    project_id: null,
    // Spec 272 U1: skill grade joins the roster row model.
    level: null,
    cost_confirmed_at: null,
    // Spec 332: trade tags joined the row model.
    trades: [],
    // DC edit matrix: payee fields joined the row model (bank null for bound workers).
    phone: null,
    tax_id: null,
    bank_name: null,
    bank_account_number: null,
    bank_account_name: null,
    gender: null,
    payoutState: null,
  },
];

/** Spec 362 U3 — the add form is behind a door now; open it before filling. */
function openAddSheet() {
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มช่าง" }));
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockAssign.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockToastError.mockReset();
  mockFriction.mockReset();
});

describe("WorkerRosterManager notes", () => {
  it("shows a worker's note on the row", () => {
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);
    expect(screen.getByText(/หัวหน้าทีม/)).toBeInTheDocument();
  });

  it("passes the note when adding a worker", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "คนใหม่" } });
    // monthly (default) needs no day rate; the note still forwards.
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "ทดลองงาน" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ note: "ทดลองงาน" })),
    );
  });

  // Spec 266 U3 (ADR 0073) — DC→ช่าง merge: the add form carries two ORTHOGONAL
  // selectors — การจ่าย (pay_type: รายเดือน/รายวัน) and สถานะ (employment_type:
  // ประจำ/ชั่วคราว, shown for every ช่าง). day_rate + payee fields gate on
  // การจ่าย=รายวัน. No own/DC vocabulary remains.
  it("add form shows การจ่าย + สถานะ selectors; สถานะ is always visible", () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    // สถานะ (employment_type) is independent of pay_type → visible from the start.
    expect(screen.getByRole("radio", { name: "ประจำ" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ชั่วคราว" })).toBeInTheDocument();
    // การจ่าย (pay_type).
    expect(screen.getByRole("radio", { name: "รายเดือน" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "รายวัน" })).toBeInTheDocument();
    // the old own/DC radio is gone.
    expect(screen.queryByRole("radio", { name: "ทีมงาน DC" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "ช่างบริษัท" })).not.toBeInTheDocument();
  });

  it("gates day_rate + payee fields on การจ่าย=รายวัน (daily)", () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    // monthly default → no day rate, no bank/payee.
    expect(screen.queryByLabelText("ค่าแรงต่อวัน (บาท)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("เลขบัญชีธนาคาร")).not.toBeInTheDocument();
    // switch to รายวัน → day rate + payee appear; still no ผู้รับเหมา parent picker.
    fireEvent.click(screen.getByRole("radio", { name: "รายวัน" }));
    expect(screen.getByLabelText("ค่าแรงต่อวัน (บาท)")).toBeInTheDocument();
    expect(screen.getByLabelText("เลขบัญชีธนาคาร")).toBeInTheDocument();
    expect(screen.queryByLabelText("ผู้รับเหมา")).not.toBeInTheDocument();
  });

  it("adds a daily, temporary ช่าง with bank via the two selectors", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "ช่างรายวัน" } });
    fireEvent.click(screen.getByRole("radio", { name: "รายวัน" })); // การจ่าย
    fireEvent.click(screen.getByRole("radio", { name: "ชั่วคราว" })); // สถานะ
    fireEvent.change(screen.getByLabelText("ค่าแรงต่อวัน (บาท)"), { target: { value: "420" } });
    fireEvent.change(screen.getByLabelText("เลขบัญชีธนาคาร"), { target: { value: "1234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ช่างรายวัน",
          // seam: การจ่าย=รายวัน maps to createWorker's workerType 'dc' (own/dc is
          // the action's internal vocabulary → pay_type at the RPC boundary).
          workerType: "dc",
          employmentType: "temporary",
          dayRate: 420,
          bankAccountNumber: "1234567890",
        }),
      ),
    );
  });

  it("adds a monthly ช่าง with no day rate or payee, permanent by default", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "ช่างรายเดือน" } });
    // การจ่าย stays รายเดือน; the button enables without a day rate.
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ช่างรายเดือน",
          workerType: "own",
          employmentType: "permanent",
          dayRate: 0,
        }),
      ),
    );
  });

  it("groups the roster by การจ่าย, dropping the DC/own group labels", () => {
    render(
      <WorkerRosterManager
        workers={[
          { ...WORKERS[0]!, id: "m1", name: "คนรายเดือน", pay_type: "monthly" },
          { ...WORKERS[0]!, id: "d1", name: "คนรายวัน", pay_type: "daily" },
        ]}
        contractors={[]}
      />,
    );
    expect(screen.getByText("ช่างรายเดือน")).toBeInTheDocument();
    expect(screen.getByText("ช่างรายวัน")).toBeInTheDocument();
    expect(screen.queryByText("ทีมงาน DC")).not.toBeInTheDocument();
    expect(screen.queryByText("ช่างบริษัท")).not.toBeInTheDocument();
  });

  it("passes the note when editing a worker", async () => {
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
    // Spec 362 U3: the add form is behind its own door, so the edit sheet holds
    // the ONLY หมายเหตุ field — no index games.
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), {
      target: { value: "เลื่อนเป็นโฟร์แมน" },
    });
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

    fireEvent.click(screen.getByRole("button", { name: /^ปิดใช้งาน/ }));

    // Optimistic: the label flips + the inactive status suffix appears immediately,
    // while the action is still pending; the toggle does NOT router.refresh.
    expect(await screen.findByRole("button", { name: /^เปิดใช้งาน/ })).toBeInTheDocument();
    expect(screen.getByText(/\(ปิดใช้งาน\)/)).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledWith({ id: "w1", active: false });
    expect(mockRefresh).not.toHaveBeenCalled();

    resolveUpdate({ ok: true });
    // Commit: still flipped after the transition settles.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^เปิดใช้งาน/ })).toBeInTheDocument(),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("rolls back the flip and toasts on a failed toggle", async () => {
    mockUpdate.mockReset().mockResolvedValue({ ok: false, error: "ปรับสถานะไม่สำเร็จ" });
    render(<WorkerRosterManager workers={WORKERS} contractors={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /^ปิดใช้งาน/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("ปรับสถานะไม่สำเร็จ"));
    // Reverted: button back to ปิดใช้งาน, the inactive suffix gone, no refresh.
    expect(screen.getByRole("button", { name: /^ปิดใช้งาน/ })).toBeInTheDocument();
    expect(screen.queryByText(/\(ปิดใช้งาน\)/)).not.toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// A worker is assigned to one project at a time (workers.project_id). The roster
// surfaces the current project and lets the assigner move it.
describe("WorkerRosterManager project assignment", () => {
  const PROJECTS = [
    // Spec 272 U2: the assignable-project shape now carries ht_worker_id.
    { id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ", ht_worker_id: null },
    { id: "p2", code: "PRC-2026-002", name: "อาคารบี", ht_worker_id: null },
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
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
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
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "ช่างใหม่" } });
    // monthly (default) → no day-rate field; the project still forwards.
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
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
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
    // change only the name (the edit sheet's, not the add form's), project stays p1
    const names = screen.getAllByLabelText("ชื่อ");
    fireEvent.change(names[names.length - 1]!, { target: { value: "ช่างใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

// DC edit matrix — the per-row edit sheet gains การจ่าย × สถานะ + payee fields
// (phone/tax/bank), forwarded through updateWorker. Bank is editable only for an
// UNBOUND worker (no portal user_id); a bound worker sees a pending-request notice
// instead (their bank changes route through the portal request + PM approval).
describe("WorkerRosterManager DC edit matrix", () => {
  const UNBOUND_DAILY: ManagedWorker = {
    ...WORKERS[0]!,
    id: "wd",
    name: "ช่างรายวัน",
    pay_type: "daily",
    portalBound: false,
    boundUserName: null,
    employment_type: "permanent",
    phone: null,
    tax_id: null,
    bank_name: null,
    bank_account_number: null,
    bank_account_name: null,
    gender: null,
    payoutState: null,
  };

  it("forwards pay/employment/phone/tax/bank edits via updateWorker (unbound worker)", async () => {
    render(<WorkerRosterManager workers={[UNBOUND_DAILY]} contractors={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
    // สถานะ radios render in BOTH the add form and the edit sheet — the edit sheet's
    // is last in the DOM (mirrors the project-select getAll pattern above).
    const temp = screen.getAllByRole("radio", { name: "ชั่วคราว" });
    fireEvent.click(temp[temp.length - 1]!);
    // The add form is monthly by default → payee fields appear only in the edit sheet.
    fireEvent.change(screen.getByLabelText("เบอร์โทร"), { target: { value: "0812345678" } });
    fireEvent.change(screen.getByLabelText("เลขผู้เสียภาษี"), {
      target: { value: "1234567890123" },
    });
    fireEvent.change(screen.getByLabelText("เลขบัญชีธนาคาร"), { target: { value: "1112223334" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "wd",
          employmentType: "temporary",
          phone: "0812345678",
          taxId: "1234567890123",
          bankAccountNumber: "1112223334",
        }),
      ),
    );
  });

  it("hides bank inputs for a portal-bound worker and shows the pending-request notice", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...UNBOUND_DAILY, id: "wb", portalBound: true }]}
        contractors={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
    // Bank fields are walled for a bound worker…
    expect(screen.queryByLabelText("เลขบัญชีธนาคาร")).not.toBeInTheDocument();
    expect(screen.getByText("รออนุมัติจากคำขอของช่าง")).toBeInTheDocument();
    // …but phone/tax stay editable (only bank is bind-gated).
    expect(screen.getByLabelText("เบอร์โทร")).toBeInTheDocument();
  });

  it("does not forward bank fields when editing a bound worker", async () => {
    render(
      <WorkerRosterManager
        workers={[{ ...UNBOUND_DAILY, id: "wb", portalBound: true }]}
        contractors={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
    fireEvent.change(screen.getByLabelText("เบอร์โทร"), { target: { value: "0800000000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const arg = mockUpdate.mock.calls[0]![0];
    expect(arg).toMatchObject({ id: "wb", phone: "0800000000" });
    expect(arg).not.toHaveProperty("bankName");
    expect(arg).not.toHaveProperty("bankAccountNumber");
    expect(arg).not.toHaveProperty("bankAccountName");
  });
});

// Spec 357 U-F — เพศ (gender) on the roster forms: an optional ชาย/หญิง
// RadioChip pair on add + edit; omitted = not sent (create defaults null,
// update keeps). The muster cockpit renders the ช/ญ chip from this data.
describe("WorkerRosterManager gender (spec 357 U-F)", () => {
  it("add form offers ชาย/หญิง; picking one threads gender to createWorker", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "คนใหม่" } });
    fireEvent.click(screen.getByRole("radio", { name: "หญิง" }));
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ gender: "female" })),
    );
  });

  it("add form without a pick sends no gender at all", async () => {
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "คนใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.not.objectContaining({ gender: expect.anything() }),
      ),
    );
  });

  it("edit sheet prefills the stored gender and saves a change", async () => {
    render(<WorkerRosterManager workers={[{ ...WORKERS[0]!, gender: "male" }]} contractors={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
    // The edit sheet's ชาย chip is pre-selected from the row…
    const radios = screen.getAllByRole("radio", { name: "ชาย" });
    expect((radios[radios.length - 1] as HTMLInputElement).checked).toBe(true);
    // …flip to หญิง and save.
    const female = screen.getAllByRole("radio", { name: "หญิง" });
    fireEvent.click(female[female.length - 1]!);
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "w1", gender: "female" }),
      ),
    );
  });
});

// Field incident 2026-08-04 (/workers 14:35 BKK) — a procurement user re-added a
// ช่าง who was ALREADY on the roster: `workers_tax_id_unique` refused the insert
// with 23505 (proved live) and the sheet showed "บันทึกช่างไม่สำเร็จ กรุณาลองใหม่
// อีกครั้ง". Three defects in one place: the copy asked for a retry that can never
// succeed, it named neither the cause nor the person collided with, and a thrown
// transport left the button stuck at กำลังบันทึก… forever (no try/finally).
//
// The roster page already ships every worker's tax_id to this client component (the
// edit sheet prefills it), so the collision is knowable BEFORE the round trip.
describe("WorkerRosterManager duplicate เลขผู้เสียภาษี", () => {
  const EXISTING: ManagedWorker = {
    ...WORKERS[0]!,
    id: "w-dup",
    name: "พิมพ์ใจ วงษ์อ่อน",
    pay_type: "daily",
    tax_id: "1160400054920",
  };

  /** Fill the add sheet as a daily ช่าง carrying `taxId`. */
  function fillDailyAdd(taxId: string) {
    openAddSheet();
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "พิมพ์ใจ วงษ์อ่อน" } });
    fireEvent.click(screen.getByRole("radio", { name: "รายวัน" }));
    fireEvent.change(screen.getByLabelText("ค่าแรงต่อวัน (บาท)"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("เลขผู้เสียภาษี"), { target: { value: taxId } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
  }

  it("refuses before the round trip and NAMES the ช่าง already holding that เลขบัตร", async () => {
    render(<WorkerRosterManager workers={[EXISTING]} contractors={[]} />);
    fillDailyAdd("1160400054920");

    // Scoped to the refusal itself — the roster row behind the sheet carries the
    // same name, and a bare text query would pass on that alone.
    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent("พิมพ์ใจ วงษ์อ่อน");
    // The refusal is permanent — it must not invite a retry, and it must not spend
    // a round trip to learn what the client already knows.
    expect(refusal).not.toHaveTextContent("ลองใหม่อีกครั้ง");
    expect(mockCreate).not.toHaveBeenCalled();
    // Diagnosability: the refusal is the thing nobody could see in the field.
    expect(mockFriction).toHaveBeenCalledWith(
      "validation_error",
      expect.objectContaining({ where: "workers_add", reason: "duplicate_tax_id" }),
    );
  });

  it("leaves an unseen เลขบัตร alone (the guard fires on a real collision only)", async () => {
    render(<WorkerRosterManager workers={[EXISTING]} contractors={[]} />);
    fillDailyAdd("1160400054921");
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  });

  it("ดูช่างคนเดิม closes the sheet and puts that worker's row on screen", async () => {
    render(
      <WorkerRosterManager
        workers={[EXISTING, { ...WORKERS[0]!, id: "w-other", name: "ช่างอื่น" }]}
        contractors={[]}
      />,
    );
    fillDailyAdd("1160400054920");

    fireEvent.click(await screen.findByRole("button", { name: "ดูช่างคนเดิม" }));
    // The sheet is gone (its add button is back to being the only door)…
    await waitFor(() => expect(screen.queryByLabelText("เลขผู้เสียภาษี")).not.toBeInTheDocument());
    // …and the roster below is filtered down to the person collided with.
    expect(screen.getByText(/พิมพ์ใจ วงษ์อ่อน/)).toBeInTheDocument();
    expect(screen.queryByText("ช่างอื่น")).not.toBeInTheDocument();
  });

  // Self-review: the refusal names a person, so it must not outlive the number that
  // produced it — a stale ดูช่างคนเดิม would send the user to someone unrelated.
  it("retires the refusal and its door as soon as the เลขบัตร is edited", async () => {
    render(<WorkerRosterManager workers={[EXISTING]} contractors={[]} />);
    fillDailyAdd("1160400054920");
    expect(await screen.findByRole("button", { name: "ดูช่างคนเดิม" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("เลขผู้เสียภาษี"), {
      target: { value: "116040005492" },
    });
    expect(screen.queryByRole("button", { name: "ดูช่างคนเดิม" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still maps a server-side duplicate refusal (the race the pre-check cannot see)", async () => {
    mockCreate.mockResolvedValueOnce({ ok: false, error: "เลขบัตรประชาชนนี้มีอยู่แล้วในระบบ" });
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    fillDailyAdd("1160400054920");
    expect(await screen.findByText(/เลขบัตรประชาชนนี้มีอยู่แล้วในระบบ/)).toBeInTheDocument();
  });

  it("never sticks at กำลังบันทึก… when the action throws", async () => {
    mockCreate.mockReset().mockRejectedValue(new Error("Failed to fetch"));
    render(<WorkerRosterManager workers={[]} contractors={[]} />);
    fillDailyAdd("1160400054920");

    // The transport failure is reported…
    expect(await screen.findByText(/เชื่อมต่อไม่สำเร็จ/)).toBeInTheDocument();
    // …the button is usable again (busy cleared in a finally)…
    const button = screen.getByRole("button", { name: "เพิ่มรายชื่อ" });
    expect(button).toBeEnabled();
    // …and the throw stays observable, exactly as the unhandled rejection was.
    expect(mockFriction).toHaveBeenCalledWith(
      "js_error",
      expect.objectContaining({ where: "workers_add" }),
    );
  });
});

// #945 follow-up — the EDIT sheet writes tax_id too (DC edit matrix), so it can
// collide exactly the same way. It got the honest server copy but not the name or
// the door, because the row component held no roster list. Parity, with the one
// difference the edit case forces: a row's OWN unchanged เลขบัตร is not a collision.
describe("WorkerRosterManager duplicate เลขผู้เสียภาษี — edit sheet", () => {
  const HOLDER: ManagedWorker = {
    ...WORKERS[0]!,
    id: "w-holder",
    name: "พิมพ์ใจ วงษ์อ่อน",
    pay_type: "daily",
    tax_id: "1160400054920",
  };
  const OTHER: ManagedWorker = {
    ...WORKERS[0]!,
    id: "w-other",
    name: "สมชาย ใจดี",
    pay_type: "daily",
    tax_id: "3461300175126",
  };

  /** Open the edit sheet of the LAST rendered row and type a เลขบัตร into it. */
  function editRowTaxId(rowName: string, taxId: string) {
    fireEvent.click(screen.getByRole("button", { name: `แก้ไข ${rowName}` }));
    const fields = screen.getAllByLabelText("เลขผู้เสียภาษี");
    fireEvent.change(fields[fields.length - 1]!, { target: { value: taxId } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
  }

  it("refuses before the round trip and NAMES the ช่าง already holding that เลขบัตร", async () => {
    render(<WorkerRosterManager workers={[HOLDER, OTHER]} contractors={[]} />);
    editRowTaxId(OTHER.name, "1160400054920");

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent("พิมพ์ใจ วงษ์อ่อน");
    expect(refusal).not.toHaveTextContent("ลองใหม่อีกครั้ง");
    // Nothing is written — not the tax id, and not the other fields riding the same
    // save, so the user never half-saves a record they are about to correct.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetRate).not.toHaveBeenCalled();
    expect(mockFriction).toHaveBeenCalledWith(
      "validation_error",
      expect.objectContaining({ where: "workers_edit", reason: "duplicate_tax_id" }),
    );
  });

  // The edit case's own trap: the row already OWNS that number, and the unique index
  // does not fire against itself.
  it("saves normally when the row's own เลขบัตร is untouched", async () => {
    render(<WorkerRosterManager workers={[HOLDER, OTHER]} contractors={[]} />);
    fireEvent.click(screen.getByRole("button", { name: `แก้ไข ${HOLDER.name}` }));
    const notes = screen.getAllByLabelText("หมายเหตุ");
    fireEvent.change(notes[notes.length - 1]!, { target: { value: "แก้โน้ตเฉยๆ" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockFriction).not.toHaveBeenCalled();
  });

  it("ดูช่างคนเดิม closes the edit sheet and puts the holder's row on screen", async () => {
    render(<WorkerRosterManager workers={[HOLDER, OTHER]} contractors={[]} />);
    editRowTaxId(OTHER.name, "1160400054920");

    fireEvent.click(await screen.findByRole("button", { name: "ดูช่างคนเดิม" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "บันทึก" })).toBeNull());
    expect(screen.getByText(/พิมพ์ใจ วงษ์อ่อน/)).toBeInTheDocument();
    expect(screen.queryByText("สมชาย ใจดี")).not.toBeInTheDocument();
  });

  // openEditor() re-seeds every field and clears `error` precisely because this
  // state survives the sheet's unmount — the door has to be on that list too, or a
  // reopened sheet shows a stale ดูช่างคนเดิม over a freshly re-seeded field.
  it("retires the door when the sheet is closed and reopened", async () => {
    render(<WorkerRosterManager workers={[HOLDER, OTHER]} contractors={[]} />);
    editRowTaxId(OTHER.name, "1160400054920");
    expect(await screen.findByRole("button", { name: "ดูช่างคนเดิม" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    fireEvent.click(screen.getByRole("button", { name: `แก้ไข ${OTHER.name}` }));
    expect(screen.queryByRole("button", { name: "ดูช่างคนเดิม" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retires the refusal and its door as soon as the เลขบัตร is edited again", async () => {
    render(<WorkerRosterManager workers={[HOLDER, OTHER]} contractors={[]} />);
    editRowTaxId(OTHER.name, "1160400054920");
    expect(await screen.findByRole("button", { name: "ดูช่างคนเดิม" })).toBeInTheDocument();

    const fields = screen.getAllByLabelText("เลขผู้เสียภาษี");
    fireEvent.change(fields[fields.length - 1]!, { target: { value: "116040005492" } });
    expect(screen.queryByRole("button", { name: "ดูช่างคนเดิม" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// Fresh-eyes 357 U-F: the edit omit-path — a stored-gender worker whose chips
// are untouched must NOT resend gender (the update carries only changed fields).
it("editing another field leaves gender out when the chips are untouched", async () => {
  render(<WorkerRosterManager workers={[{ ...WORKERS[0]!, gender: "male" }]} contractors={[]} />);
  fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
  fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "โน้ตใหม่" } });
  fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({ gender: expect.anything() }),
    ),
  );
});
