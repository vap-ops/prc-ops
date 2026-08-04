// Writing failing test first.
//
// Spec 396 U3 — renaming a BOUND worker into a different person asks once.
//
// The incident (2026-08-04): procurement, looking for one worker, opened a
// different worker's record and renamed it, overwriting a real employee's
// identity. U1 made that recoverable from the audit log; U2 made the record say
// whose it is. This is the step that asks before the write lands.
//
// ⚠️ It must ask RARELY. Of the 11 real renames on bound workers that day, TEN
// were a bulk honorific-prefix pass — a confirm firing on those would be
// dismissed by muscle memory before it ever met the eleventh.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("@/lib/telemetry/friction", () => ({ trackFriction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: vi.fn(),
  updateWorker: mockUpdate,
  setWorkerDayRate: vi.fn(),
  assignWorkerToProject: vi.fn(),
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

const BOUND: ManagedWorker = {
  id: "wb",
  name: "เอมอร ฮามศรีพรม",
  pay_type: "daily",
  contractor_id: null,
  day_rate: 500,
  active: true,
  note: null,
  employment_type: "temporary",
  portalBound: true,
  boundUserName: "เอมอร ฮามศรีพรม",
  project_id: null,
  level: null,
  cost_confirmed_at: null,
  phone: null,
  tax_id: null,
  bank_name: null,
  bank_account_number: null,
  bank_account_name: null,
  gender: null,
  payoutAccount: null,
  trades: [],
};

const CONFIRM = "ใช่ เปลี่ยนชื่อ";
const DECLINE = "ไม่ใช่ คนละคน";

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
}
function typeName(value: string) {
  fireEvent.change(screen.getByDisplayValue(BOUND.name), { target: { value } });
}
function pressSave() {
  fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
}

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("renaming a bound worker into a different person", () => {
  it("does not write on the first press — it asks, naming the account holder", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นายเหิน เมืองงาม");
    pressSave();

    // The write is what must not happen yet.
    await waitFor(() => expect(mockUpdate).not.toHaveBeenCalled());
    // And the question has to carry the facts that make it answerable, IN THE
    // QUESTION itself — scoped to the alert, because U2's ownership line also
    // names the holder further up the sheet and a page-wide match would pass
    // even if the prompt said nothing. A bare "are you sure?" is the thing
    // people click through.
    const prompt = screen.getByRole("alert").textContent ?? "";
    expect(prompt).toContain("รายการนี้เป็นของ เอมอร ฮามศรีพรม");
    expect(prompt).toContain("นายเหิน เมืองงาม");
    expect(screen.getByRole("button", { name: CONFIRM })).toBeInTheDocument();
  });

  it("writes once confirmed", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นายเหิน เมืองงาม");
    pressSave();
    await screen.findByRole("button", { name: CONFIRM });

    fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wb", name: "นายเหิน เมืองงาม" }),
      ),
    );
  });

  it("does not write if the question is declined", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นายเหิน เมืองงาม");
    pressSave();
    await screen.findByRole("button", { name: CONFIRM });

    fireEvent.click(screen.getByRole("button", { name: DECLINE }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: CONFIRM })).not.toBeInTheDocument(),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // 🔴 The defect a fresh-eyes pass found in the first draft, now pinned.
  // Consent used to be shared state (`pendingRename === typedName`), so pressing
  // บันทึก a second time satisfied the confirm without anyone reading it —
  // exactly the muscle-memory bypass the unit exists to prevent. Only the button
  // inside the prompt may consent.
  it("a second press of บันทึก does NOT count as consent", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นายเหิน เมืองงาม");
    pressSave();
    await screen.findByRole("button", { name: CONFIRM });

    pressSave();
    pressSave();

    await waitFor(() => expect(screen.getByRole("button", { name: CONFIRM })).toBeInTheDocument());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("writes exactly once when confirmed, and the question goes away", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นายเหิน เมืองงาม");
    pressSave();
    await screen.findByRole("button", { name: CONFIRM });

    fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: CONFIRM })).not.toBeInTheDocument(),
    );
  });

  it("does not greet the next open with an abandoned question", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นายเหิน เมืองงาม");
    pressSave();
    await screen.findByRole("button", { name: CONFIRM });

    // Leave via the sheet's own cancel, then reopen.
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    openSheet();

    expect(screen.queryByRole("button", { name: CONFIRM })).not.toBeInTheDocument();
  });

  // ⚠️ The rarity guarantee. If these two ever start asking, the confirm is
  // worthless — it becomes the dialog everyone dismisses.
  it("stays SILENT for an honorific normalisation — the 10-of-11 case", async () => {
    render(<WorkerRosterManager workers={[BOUND]} contractors={[]} />);
    openSheet();
    typeName("นางสาวเอมอร ฮามศรีพรม");
    pressSave();

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: CONFIRM })).not.toBeInTheDocument();
  });

  it("stays SILENT on an UNBOUND worker, however different the new name", async () => {
    // The hazard is specific to a record that belongs to someone with their own
    // login. An unbound row is back-office data and renaming it is ordinary work.
    render(
      <WorkerRosterManager
        workers={[{ ...BOUND, id: "wu", portalBound: false, boundUserName: null }]}
        contractors={[]}
      />,
    );
    openSheet();
    typeName("คนละคนกันเลย");
    pressSave();

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: CONFIRM })).not.toBeInTheDocument();
  });
});
