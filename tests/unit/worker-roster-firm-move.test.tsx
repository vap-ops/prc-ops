// Writing failing test first.
//
// Spec 328 (build-queue ③, 2026-07-19) — firm-member move/assign on the /workers
// edit sheet: a ทีมผู้รับเหมา picker over the ACTIVE contractors. Assigning an
// untied worker to a firm = roster backfill (D1 — the member becomes pay-exempt);
// firm→firm = wrong-firm correction. REMOVE (tied → ทีม PRC) is deliberately NOT
// offered: update_worker's p_contractor coalesce cannot clear, and converting a
// pay-exempt member back to payable is an operator money-judgment. The picker
// forwards contractorId through updateWorker only when changed.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockSetRate, mockAssign, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSetRate: vi.fn(),
  mockAssign: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: mockCreate,
  updateWorker: mockUpdate,
  setWorkerDayRate: mockSetRate,
  assignWorkerToProject: mockAssign,
  setWorkerLevel: vi.fn(),
  assignProjectHt: vi.fn(),
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
  type ManagedWorker,
} from "@/components/features/labor/worker-roster-manager";

function worker(overrides: Partial<ManagedWorker>): ManagedWorker {
  return {
    id: "w1",
    name: "ช่างหนึ่ง",
    pay_type: "daily",
    contractor_id: null,
    day_rate: 500,
    active: true,
    note: null,
    employment_type: "permanent",
    portalBound: false,
    project_id: null,
    level: null,
    phone: null,
    tax_id: null,
    bank_name: null,
    bank_account_number: null,
    bank_account_name: null,
    ...overrides,
  };
}

const CONTRACTORS = [
  { id: "c1", name: "ช่างอวย", status: "active" },
  { id: "c2", name: "วุฒินันท์", status: "active" },
  { id: "c3", name: "ทีมเก่า (แบล็คลิสต์)", status: "blacklisted" },
];

async function openEdit(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = screen.getByText(name).closest("li")!;
  await user.click(within(row as HTMLElement).getByRole("button", { name: "แก้ไข" }));
  return row as HTMLElement;
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockAssign.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("WorkerRosterManager — ทีมผู้รับเหมา picker (spec 328 firm move)", () => {
  it("edit sheet shows the firm picker with ACTIVE firms only", async () => {
    const user = userEvent.setup();
    render(<WorkerRosterManager workers={[worker({})]} contractors={CONTRACTORS} />);
    await openEdit(user, "ช่างหนึ่ง");
    const select = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getByText("ช่างอวย")).toBeInTheDocument();
    expect(within(select).getByText("วุฒินันท์")).toBeInTheDocument();
    expect(within(select).queryByText(/ทีมเก่า/)).not.toBeInTheDocument();
  });

  it("assigning an untied worker to a firm forwards contractorId on save", async () => {
    const user = userEvent.setup();
    render(<WorkerRosterManager workers={[worker({})]} contractors={CONTRACTORS} />);
    await openEdit(user, "ช่างหนึ่ง");
    await user.selectOptions(screen.getByLabelText("ทีมผู้รับเหมา"), "c1");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", contractorId: "c1" }),
    );
  });

  it("a tied worker offers NO empty (ทีม PRC) option — remove is not built", async () => {
    const user = userEvent.setup();
    render(
      <WorkerRosterManager workers={[worker({ contractor_id: "c1" })]} contractors={CONTRACTORS} />,
    );
    await openEdit(user, "ช่างหนึ่ง");
    const select = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    expect(select.value).toBe("c1");
    const emptyOptions = [...select.options].filter((o) => o.value === "");
    expect(emptyOptions).toHaveLength(0);
  });

  it("moving a tied worker firm→firm forwards the NEW contractorId", async () => {
    const user = userEvent.setup();
    render(
      <WorkerRosterManager workers={[worker({ contractor_id: "c1" })]} contractors={CONTRACTORS} />,
    );
    await openEdit(user, "ช่างหนึ่ง");
    await user.selectOptions(screen.getByLabelText("ทีมผู้รับเหมา"), "c2");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", contractorId: "c2" }),
    );
  });

  it("keeps a tied worker's now-inactive firm selectable (select shows the truth)", async () => {
    const user = userEvent.setup();
    render(
      <WorkerRosterManager workers={[worker({ contractor_id: "c3" })]} contractors={CONTRACTORS} />,
    );
    await openEdit(user, "ช่างหนึ่ง");
    const select = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    expect(select.value).toBe("c3");
    expect(within(select).getByText(/ทีมเก่า/)).toBeInTheDocument();
  });

  it("hides the firm picker for a monthly (salaried) worker", async () => {
    const user = userEvent.setup();
    render(
      <WorkerRosterManager workers={[worker({ pay_type: "monthly" })]} contractors={CONTRACTORS} />,
    );
    await openEdit(user, "ช่างหนึ่ง");
    expect(screen.queryByLabelText("ทีมผู้รับเหมา")).not.toBeInTheDocument();
  });

  it("an unchanged firm does not forward contractorId", async () => {
    const user = userEvent.setup();
    render(
      <WorkerRosterManager workers={[worker({ contractor_id: "c1" })]} contractors={CONTRACTORS} />,
    );
    await openEdit(user, "ช่างหนึ่ง");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ contractorId: "c1" }));
  });
});
