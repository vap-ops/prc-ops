// Writing failing test first.
//
// Spec 395 U2 — surface the payout-account state where the work happens.
//
// U1 made the gap countable: 8 of 40 banked workers are `unrecorded` — 7 across three
// shared accounts (one of them three technicians paying into a MINOR's account) plus
// one whose holder name does not match. Nothing on screen said so, and the consented
// mechanism (spec 320's `worker_payout_nominee`) has 0 rows all-time.
//
// ⚠️ COPY RULE, from the operator: "some technicians use family's account temporarily".
// A non-matching holder is NORMAL here. `unrecorded` means NOT WRITTEN DOWN YET — the
// badge invites a record and must never read as an error.
//
// ⚠️ TWO DIFFERENT FACTS SHARE ONE STATE, and they need different remedies. On a shared
// account the holder is often one of the workers themselves — live 2026-08-05, 2 of the
// 3 shared groups contain their own owner (ปาณิศา on 1130967980, นางแก้ว on 020087576927).
// That person needs NO บัญชีตัวแทน; telling them to record one would have them invent a
// nominee for their own account. Only the OTHER rows on that account have work to do.
//
// ⚠️ Wording is taken from the DESTINATION, not invented: the nominee page is titled
// `บัญชีตัวแทนรับเงิน (ชั่วคราว)`, so the badge says `บัญชีตัวแทน`.

import { fireEvent, render, screen, within } from "@testing-library/react";
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
import {
  PAYOUT_ACCOUNT_OWNER_SHARED_HINT,
  PAYOUT_ACCOUNT_RECORD_CTA,
  PAYOUT_ACCOUNT_SHARED_BADGE,
  PAYOUT_ACCOUNT_THIRD_PARTY_HINT,
  PAYOUT_ACCOUNT_UNRECORDED_BADGE,
} from "@/lib/i18n/labels";

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
  payoutAccount: null,
};

// The third party: paid into somebody else's account.
const THIRD_PARTY = { state: "unrecorded", isShared: true, nameMatches: false } as const;
// The holder of a shared account, who is also a worker on it.
const OWNER = { state: "unrecorded", isShared: true, nameMatches: true } as const;

const openEditSheet = () => fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
const sheet = () => screen.getByRole("dialog");

describe("WorkerRosterManager — spec 395 U2, the payout-account signal", () => {
  it("badges a third-party row with the destination's own term", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutAccount: THIRD_PARTY }]} contractors={[]} />,
    );
    expect(screen.getByText(new RegExp(PAYOUT_ACCOUNT_UNRECORDED_BADGE))).toBeInTheDocument();
  });

  // ⚠️ The owner is NOT missing a nominee record — the account is theirs. Saying
  // "ยังไม่ได้บันทึกบัญชีตัวแทน" to them would be false and would invite invented data.
  it("tells the account's OWNER a different fact, not the nominee one", () => {
    render(<WorkerRosterManager workers={[{ ...BASE, payoutAccount: OWNER }]} contractors={[]} />);
    expect(screen.getByText(new RegExp(PAYOUT_ACCOUNT_SHARED_BADGE))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(PAYOUT_ACCOUNT_UNRECORDED_BADGE))).toBeNull();
  });

  it("renders nothing for own or nominee, and nothing when the state is unknown", () => {
    const cases = [
      { state: "own", isShared: false, nameMatches: true } as const,
      { state: "nominee", isShared: true, nameMatches: false } as const,
      null,
    ];
    for (const payoutAccount of cases) {
      const { unmount } = render(
        <WorkerRosterManager workers={[{ ...BASE, payoutAccount }]} contractors={[]} />,
      );
      expect(screen.queryByText(new RegExp(PAYOUT_ACCOUNT_UNRECORDED_BADGE))).toBeNull();
      expect(screen.queryByText(new RegExp(PAYOUT_ACCOUNT_SHARED_BADGE))).toBeNull();
      unmount();
    }
  });

  // ⚠️ Scans with the SHEET OPEN: the hint and the CTA are the only copy that could
  // plausibly accuse, and neither is in the DOM while the row is collapsed.
  it("never accuses — including the sheet copy, where the explanation lives", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutAccount: THIRD_PARTY }]} contractors={[]} />,
    );
    openEditSheet();
    expect(within(sheet()).getByText(PAYOUT_ACCOUNT_THIRD_PARTY_HINT)).toBeInTheDocument();
    for (const bad of ["ผิด", "ไม่ถูกต้อง", "ผิดพลาด", "เตือน", "ห้าม"]) {
      expect(document.body.textContent, `must not say ${bad}`).not.toContain(bad);
    }
  });

  // ⚠️ Scoped INSIDE the dialog. The row chip stays mounted while the sheet is open, so
  // an unscoped query passes with the whole sheet block deleted.
  it("explains it in the sheet, where the bank fields are", () => {
    render(
      <WorkerRosterManager workers={[{ ...BASE, payoutAccount: THIRD_PARTY }]} contractors={[]} />,
    );
    openEditSheet();
    expect(within(sheet()).getByText(PAYOUT_ACCOUNT_THIRD_PARTY_HINT)).toBeInTheDocument();
  });

  // ⚠️ The EXACT href, not a prefix. `?worker=` is mandatory: the nominee picker lists
  // only workers with no bank of their own, so every worker this fires on is structurally
  // absent from it. Lose the query string and the feature dead-ends at an empty list.
  it("deep-links the CTA to this worker, since the picker cannot list them", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...BASE, id: "w-42", payoutAccount: THIRD_PARTY }]}
        contractors={[]}
      />,
    );
    openEditSheet();
    const cta = within(sheet()).getByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA });
    expect(cta.getAttribute("href")).toBe("/settings/payout-nominees/edit?worker=w-42");
  });

  it("still offers the nominee route when the bank fields are locked (portal-bound)", () => {
    render(
      <WorkerRosterManager
        workers={[
          {
            ...BASE,
            id: "wb",
            portalBound: true,
            boundUserName: "เอมอร",
            payoutAccount: THIRD_PARTY,
          },
        ]}
        contractors={[]}
      />,
    );
    openEditSheet();
    const cta = within(sheet()).getByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA });
    expect(cta.getAttribute("href")).toBe("/settings/payout-nominees/edit?worker=wb");
  });

  // The owner's remedy is on somebody else's row, so offering them the form would be
  // an invitation to fabricate a nominee for their own account.
  it("offers the OWNER no CTA — their row has nothing to record", () => {
    render(<WorkerRosterManager workers={[{ ...BASE, payoutAccount: OWNER }]} contractors={[]} />);
    openEditSheet();
    expect(within(sheet()).getByText(PAYOUT_ACCOUNT_OWNER_SHARED_HINT)).toBeInTheDocument();
    expect(within(sheet()).queryByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA })).toBeNull();
  });

  // The consent document is required by set_worker_payout_nominee and is spec §8 Q1's
  // leading suspect for 0 rows all-time. The CTA must not read as one tap.
  it("names the consent document in the CTA rather than implying one tap", () => {
    expect(PAYOUT_ACCOUNT_RECORD_CTA).toContain("หนังสือยินยอม");
  });
});
