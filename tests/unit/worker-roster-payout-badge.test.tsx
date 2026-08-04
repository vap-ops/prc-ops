// Writing failing test first.
//
// Spec 395 U2 — surface the payout-account state where the work happens.
//
// U1 made the gap countable: 8 of 40 banked workers are `unrecorded` — 7 across three
// shared accounts (one of them three technicians paying into a MINOR's account) plus
// one whose holder name does not match. Nothing on screen says so, and the consented
// mechanism (spec 320's `worker_payout_nominee`) has 0 rows all-time.
//
// ⚠️ COPY RULE, from the operator: "some technicians use family's account temporarily".
// A non-matching holder is NORMAL here. `unrecorded` means NOT WRITTEN DOWN YET — the
// badge is an invitation to record it, and must never read as an error or an accusation.
//
// ⚠️ The wording is taken from the DESTINATION, not invented: the nominee page is
// titled `บัญชีตัวแทนรับเงิน (ชั่วคราว)` (PAYOUT_NOMINEE_TITLE), so the badge says
// `บัญชีตัวแทน`. A badge naming a concept the destination does not use sends the reader
// looking for a control that appears (to them) not to exist.
//
// ⚠️ It points at the NOMINEE record, never at "fix the bank": of the 8 live cases, 2
// are portal-bound, where spec 396's `bankEditable = !worker.portalBound` lock means the
// bank fields cannot be edited at all. Only the nominee route resolves all 8.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("@/lib/telemetry/friction", () => ({ trackFriction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
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

const BASE: ManagedWorker = {
  id: "w1",
  name: "ช่างหนึ่ง",
  pay_type: "daily",
  contractor_id: null,
  day_rate: 500,
  active: true,
  note: null,
  employment_type: "temporary",
  portalBound: false,
  boundUserName: null,
  project_id: null,
  level: null,
  cost_confirmed_at: null,
  phone: null,
  tax_id: null,
  bank_name: null,
  bank_account_number: null,
  bank_account_name: null,
  gender: null,
  trades: [],
  payoutState: null,
};

const BADGE = "ยังไม่ได้บันทึกบัญชีตัวแทน";

function openEditSheet() {
  fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
}

describe("WorkerRosterManager — spec 395 U2, the payout-account badge", () => {
  it("badges an unrecorded row with the destination's own term", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutState: "unrecorded" }]} contractors={[]} />,
    );
    // EXACT string: this wording carries the "invitation, never an error" decision
    // and mirrors PAYOUT_NOMINEE_TITLE. A copy change should require a deliberate edit.
    expect(screen.getByText(new RegExp(BADGE))).toBeInTheDocument();
  });

  // Absence means "fine" — the same convention the row's other chips already use.
  // Badging `own` would put a mark on 32 of 40 rows and drown the 8 that need work.
  it("renders nothing for own or nominee, and nothing when the state is unknown", () => {
    for (const state of ["own", "nominee", null] as const) {
      const { unmount } = render(
        <WorkerRosterManager workers={[{ ...BASE, payoutState: state }]} contractors={[]} />,
      );
      expect(screen.queryByText(new RegExp(BADGE)), `state=${state}`).toBeNull();
      unmount();
    }
  });

  // ⚠️ The badge must not read as a fault. These are the words that would make it one;
  // none of them may appear anywhere in the roster.
  it("never accuses — no error/warning vocabulary anywhere on the surface", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutState: "unrecorded" }]} contractors={[]} />,
    );
    for (const bad of ["ผิด", "ไม่ถูกต้อง", "ผิดพลาด", "เตือน", "ห้าม"]) {
      expect(document.body.textContent, `must not say ${bad}`).not.toContain(bad);
    }
  });

  it("shows the same signal on the edit sheet, where the bank fields are", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutState: "unrecorded" }]} contractors={[]} />,
    );
    openEditSheet();
    expect(screen.getAllByText(new RegExp(BADGE)).length).toBeGreaterThanOrEqual(1);
  });

  // The one action that resolves ALL eight live cases — including the two whose bank
  // fields are locked by spec 396's portal-bound rule.
  it("links to the nominee surface so the badge is actionable", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutState: "unrecorded" }]} contractors={[]} />,
    );
    openEditSheet();
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.startsWith("/settings/payout-nominees"));
    expect(link, "the badge needs a route to the control").toBeDefined();
  });

  // A bank-locked worker is precisely the case where "edit the account" is impossible,
  // so the sheet must still offer the nominee route rather than going quiet.
  it("still offers the nominee route when the bank fields are locked (portal-bound)", () => {
    render(
      <WorkerRosterManager
        workers={[
          { ...BASE, portalBound: true, boundUserName: "เอมอร", payoutState: "unrecorded" },
        ]}
        contractors={[]}
      />,
    );
    openEditSheet();
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.startsWith("/settings/payout-nominees"));
    expect(link, "a bank-locked worker still needs the nominee route").toBeDefined();
  });
});
