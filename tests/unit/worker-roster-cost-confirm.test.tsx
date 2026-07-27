// Writing failing test first.
//
// Spec 368 U1 — the cost-confirm door. `confirm_worker_cost` (super_admin, sets
// level + derives day_rate from worker_level_rates + stamps cost_confirmed_at) has
// existed since spec 314 U3 with NO caller anywhere in src/. That is why 0 of 31
// workers are cost-confirmed, which is why derive_muster_labor skips every worker,
// which is why labor_logs is empty and every ADR-0060 engine downstream reads zero.
//
// Distinct from setWorkerLevel (level only, save-coupled): confirm is its own
// instant action — the promoteToHt pattern — because it also writes MONEY.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { mockConfirmCost, mockSetLevel, mockRefresh } = vi.hoisted(() => ({
  mockConfirmCost: vi.fn(),
  mockSetLevel: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
  setWorkerDayRate: vi.fn(),
  assignWorkerToProject: vi.fn(),
  setWorkerLevel: mockSetLevel,
  setWorkerTrades: vi.fn(),
  assignProjectHt: vi.fn(),
  confirmWorkerCost: mockConfirmCost,
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

const DAILY: ManagedWorker = {
  id: "w1",
  name: "ช่างหนึ่ง",
  pay_type: "daily",
  contractor_id: null,
  day_rate: 0,
  active: true,
  note: null,
  employment_type: "temporary",
  portalBound: false,
  project_id: "p1",
  level: null,
  cost_confirmed_at: null,
  trades: [],
  phone: null,
  tax_id: null,
  bank_name: null,
  bank_account_number: null,
  bank_account_name: null,
  gender: null,
};

const P1: AssignableProject = {
  id: "p1",
  code: "PRC-2026-001",
  name: "บ้านคุณเอ",
  ht_worker_id: null,
};

// The live seed (entered 2026-07-15), grossed per basis by the page.
const RATES = { senior: 650, mid: 600, junior: 500, apprentice: 400 } as const;

const CONFIRM = "ยืนยันค่าแรงและระดับ";

function openEdit(name: string | RegExp = /^แก้ไข/) {
  fireEvent.click(screen.getAllByRole("button", { name })[0]!);
}

function pickLevel(value: string) {
  fireEvent.change(screen.getByLabelText("ระดับช่าง"), { target: { value } });
}

beforeEach(() => {
  mockConfirmCost.mockReset().mockResolvedValue({ ok: true });
  mockSetLevel.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("spec 368 U1 — the cost-confirm door on /workers", () => {
  it("offers the confirm only to super_admin (canGrade), matching the RPC's own gate", () => {
    const { unmount } = render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={RATES}
      />,
    );
    openEdit();
    expect(screen.getByRole("button", { name: CONFIRM })).toBeInTheDocument();
    unmount();

    // Not super_admin: confirm_worker_cost would raise 42501, so never offer it —
    // affordance-then-refuse is the spec-187 defect this repo already paid for.
    render(
      <WorkerRosterManager workers={[DAILY]} contractors={[]} projects={[P1]} levelRates={RATES} />,
    );
    openEdit();
    expect(screen.queryByRole("button", { name: CONFIRM })).not.toBeInTheDocument();
  });

  it("confirms with the level picked in the sheet, then refreshes", async () => {
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={RATES}
      />,
    );
    openEdit();
    pickLevel("mid");
    fireEvent.click(screen.getByRole("button", { name: CONFIRM }));

    await waitFor(() => expect(mockConfirmCost).toHaveBeenCalledWith({ id: "w1", level: "mid" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    // The confirm carries the level itself — it must NOT also fire setWorkerLevel,
    // which would be a second write of the same value under a different audit kind.
    expect(mockSetLevel).not.toHaveBeenCalled();
  });

  it("stays disabled while the worker is ungraded and no level is picked", () => {
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={RATES}
      />,
    );
    openEdit();
    expect(screen.getByRole("button", { name: CONFIRM })).toBeDisabled();
    pickLevel("senior");
    expect(screen.getByRole("button", { name: CONFIRM })).toBeEnabled();
  });

  it("previews the standard rate the confirm will stamp, tracking the picked level", () => {
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={RATES}
      />,
    );
    openEdit();
    pickLevel("junior");
    expect(screen.getByText(/500 บาท\/วัน/)).toBeInTheDocument();
    // Re-picking must re-price — a preview pinned to the PERSISTED level would show
    // a number the confirm is not about to write.
    pickLevel("senior");
    expect(screen.getByText(/650 บาท\/วัน/)).toBeInTheDocument();
    expect(screen.queryByText(/500 บาท\/วัน/)).not.toBeInTheDocument();
  });

  it("warns instead of previewing when the picked level has no standard rate", () => {
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={{ ...RATES, apprentice: null }}
      />,
    );
    openEdit();
    pickLevel("apprentice");
    // confirm_worker_cost coalesces to the EXISTING day_rate when the level has no
    // standard — on a ฿0 worker that silently confirms a zero rate, and
    // derive_muster_labor then skips him for `day_rate > 0` anyway.
    expect(screen.getByText(/ยังไม่ได้ตั้งค่าแรงมาตรฐาน/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CONFIRM })).toBeDisabled();
  });

  it("marks a worker who is already confirmed", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...DAILY, level: "mid", day_rate: 600, cost_confirmed_at: "2026-07-28" }]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={RATES}
      />,
    );
    openEdit();
    expect(screen.getByText("ยืนยันแล้ว")).toBeInTheDocument();
  });

  // /workers/page.tsx is a Server Component vitest cannot render, so the wiring is
  // pinned by source scan (comments stripped first — prose about a symbol must not
  // satisfy the pin). Without these, the page could silently stop passing
  // levelRates and the component's NO_LEVEL_RATES default would block every
  // confirm while all component tests stayed green.
  it("the page wires levelRates and selects cost_confirmed_at", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/workers/page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // ≥2 = the derivation (`const levelRates =`) PLUS the prop pass — a bare
    // toContain would stay green after the prop is dropped.
    expect(page.split("levelRates").length - 1).toBeGreaterThanOrEqual(2);
    expect(page).toContain("levelRates={levelRates}");
    // The confirm-state column must ride the workers select, not a comment.
    expect(page).toContain("cost_confirmed_at,");
    // The preview derives via the shared helper — a second local formula would be
    // a second SSOT for a money number.
    expect(page.split("grossRate").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a refusal inline and does not refresh", async () => {
    mockConfirmCost.mockResolvedValue({ ok: false, error: "ยืนยันค่าแรงไม่สำเร็จ" });
    render(
      <WorkerRosterManager
        workers={[DAILY]}
        contractors={[]}
        projects={[P1]}
        canGrade
        levelRates={RATES}
      />,
    );
    openEdit();
    pickLevel("mid");
    fireEvent.click(screen.getByRole("button", { name: CONFIRM }));

    await waitFor(() => expect(screen.getByText("ยืนยันค่าแรงไม่สำเร็จ")).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
