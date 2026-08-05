// Writing failing test first.
//
// Spec 395 U3 — route a NEW third-party account to the right place, at the moment it
// is typed.
//
// U1 detects, U2 badges — but both act on what is already stored. The account arrives
// through the `/workers` edit sheet, where the person typing it never passes the
// nominee control at `/settings/payout-nominees`. Spec §2 argues that placement is a
// leading reason `worker_payout_nominee` has 0 rows all-time. This asks the question
// where the answer is known.
//
// ⚠️ NOT PERSISTED. §4 is explicit: no new column on `workers`. The choice routes the
// user; it records nothing. U1's detector re-derives the truth from the account itself
// on the next render, so a wrong or skipped answer costs nothing and can never become
// a stale "someone said this was fine" flag.
//
// ⚠️ Copy stays an invitation. The operator's rule holds: a family member's account is
// NORMAL here ("some technicians use family's account temporarily").

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
  PAYOUT_ACCOUNT_OWNER_QUESTION,
  PAYOUT_ACCOUNT_OWNER_SELF,
  PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE,
  PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE_HINT,
  PAYOUT_ACCOUNT_RECORD_CTA,
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

const openEditSheet = () => fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
const sheet = () => screen.getByRole("dialog");

describe("WorkerRosterManager — spec 395 U3, routing a new third-party account", () => {
  it("asks whose account this is, beside the bank fields", () => {
    render(<WorkerRosterManager workers={[BASE]} contractors={[]} />);
    openEditSheet();
    expect(within(sheet()).getByText(PAYOUT_ACCOUNT_OWNER_QUESTION)).toBeInTheDocument();
    expect(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SELF }),
    ).toBeInTheDocument();
    expect(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE }),
    ).toBeInTheDocument();
  });

  // ⚠️ Default = own. Today's flow must be unchanged for the common case: this is a
  // router, not a new required field, and 32 of 40 banked workers are already `own`.
  it("defaults to the worker's own account and offers no CTA until asked otherwise", () => {
    render(<WorkerRosterManager workers={[BASE]} contractors={[]} />);
    openEditSheet();
    expect(within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SELF })).toBeChecked();
    expect(within(sheet()).queryByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA })).toBeNull();
  });

  it("routes to the nominee flow, deep-linked, once someone else is chosen", () => {
    render(<WorkerRosterManager workers={[{ ...BASE, id: "w-77" }]} contractors={[]} />);
    openEditSheet();
    fireEvent.click(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE }),
    );
    const cta = within(sheet()).getByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA });
    // The picker cannot list a worker who has a bank account, so ?worker= is the
    // only route in — the same structural constraint U2 pinned.
    expect(cta.getAttribute("href")).toBe("/settings/payout-nominees/edit?worker=w-77");
    // ⚠️ The load-bearing claim: the money still goes to THIS account (the nominee record
    // is consent, not a redirect), and the editor must save before navigating or the
    // fields they just typed are discarded. Unasserted, that whole <p> was deletable.
    expect(within(sheet()).getByText(PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE_HINT)).toBeInTheDocument();
  });

  // ⚠️ The live majority case. U2 already tells an `unrecorded` worker's sheet that the
  // account may not be theirs; asking the question again — pre-checked "ของช่างเอง" —
  // would answer it the opposite way 40px below U2's own words, and choosing ของคนอื่น
  // would stack a SECOND identical CTA. U2 owns that conversation.
  it("stays silent when U2's detected block is already explaining the same thing", () => {
    render(
      <WorkerRosterManager
        workers={[
          {
            ...BASE,
            payoutAccount: {
              state: "unrecorded",
              isShared: true,
              nameMatches: false,
              sharedWith: [],
            },
          },
        ]}
        contractors={[]}
      />,
    );
    openEditSheet();
    expect(within(sheet()).queryByText(PAYOUT_ACCOUNT_OWNER_QUESTION)).toBeNull();
    // …and exactly ONE route to the nominee form, not two.
    expect(within(sheet()).getAllByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA })).toHaveLength(
      1,
    );
  });

  // ⚠️ The bank fields still apply. Payroll pays `workers.bank_*` — the nominee record
  // is consent and documentation, NOT a redirect. Hiding the fields on "someone else"
  // would suggest the money goes elsewhere, which is false.
  it("keeps the bank fields usable when the account belongs to someone else", () => {
    render(<WorkerRosterManager workers={[BASE]} contractors={[]} />);
    openEditSheet();
    fireEvent.click(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE }),
    );
    expect(within(sheet()).getByLabelText("เลขบัญชีธนาคาร")).toBeEnabled();
    expect(within(sheet()).getByLabelText("ชื่อบัญชี")).toBeEnabled();
  });

  // A portal-bound worker owns their bank through the request→approval flow, so there
  // is nothing to route here and the question would be noise.
  it("does not ask on a portal-bound worker, whose bank fields are locked", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...BASE, portalBound: true, boundUserName: "เอมอร" }]}
        contractors={[]}
      />,
    );
    openEditSheet();
    expect(within(sheet()).queryByText(PAYOUT_ACCOUNT_OWNER_QUESTION)).toBeNull();
  });

  it("never accuses", () => {
    render(<WorkerRosterManager workers={[BASE]} contractors={[]} />);
    openEditSheet();
    fireEvent.click(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE }),
    );
    for (const bad of ["ผิด", "ไม่ถูกต้อง", "ผิดพลาด", "เตือน", "ห้าม"]) {
      expect(document.body.textContent, `must not say ${bad}`).not.toContain(bad);
    }
  });

  // ⚠️ The sheet unmounts on close but the ROW's state does not (spec 362 U3). Without
  // an explicit re-seed an abandoned "ของคนอื่น" stays selected, so the next person to
  // open that row meets a nominee prompt nobody asked for — about an account that may
  // be perfectly ordinary.
  it("forgets an abandoned answer when the sheet is reopened", () => {
    render(<WorkerRosterManager workers={[BASE]} contractors={[]} />);
    openEditSheet();
    fireEvent.click(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE }),
    );
    expect(
      within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE }),
    ).toBeChecked();

    fireEvent.click(within(sheet()).getByRole("button", { name: "ยกเลิก" }));
    openEditSheet();
    expect(within(sheet()).getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SELF })).toBeChecked();
    expect(within(sheet()).queryByRole("link", { name: PAYOUT_ACCOUNT_RECORD_CTA })).toBeNull();
  });

  // ⚠️ Spec 392 U2a's lesson: per-row controls sharing one hardcoded `name` form ONE
  // radiogroup across rows, so choosing on row B silently clears row A. Only one edit
  // sheet is open at a time today, but the add-worker sheet can coexist — and a shared
  // name would make these two fight.
  it("scopes the radiogroup per worker so two sheets cannot collide", () => {
    render(
      <WorkerRosterManager
        workers={[
          { ...BASE, id: "wa", name: "ก" },
          { ...BASE, id: "wb", name: "ข" },
        ]}
        contractors={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข ก" }));
    const groupName = within(sheet())
      .getByRole("radio", { name: PAYOUT_ACCOUNT_OWNER_SELF })
      .getAttribute("name");
    expect(groupName).toContain("wa");
  });
});
