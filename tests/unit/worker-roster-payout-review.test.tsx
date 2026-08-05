// Writing failing test first.
//
// Spec 395 U4 — work the 8 by hand.
//
// ⚠️ SITED ON `/workers`, NOT ON A NEW SETTINGS PAGE, and the measurement is the reason:
// `/settings/payout-nominees` has **ZERO route_views all-time** (instrumentation is fine —
// `/settings/roles` 596, `/settings/company-docs` 191 in the same window). A review list
// built there would be a worklist nobody opens, which is exactly the failure spec 396 U4
// existed to fix. `/workers` gets 686 views / 30d from procurement, already carries U2's
// badges and U3's routes, and is where the corrections are actually made.
//
// So U4 is two things the roster was missing:
//   ① a way to SEE only the flagged rows instead of scanning 43
//   ② the fact that decides each one — WHO ELSE is on this account
//
// ⚠️ ② is the crux. §5 says the outcomes are "confirm own / record a nominee / correct a
// typo", and nothing on screen distinguishes them today. Seeing that อนันตชัย's account is
// shared by three OTHER technicians says "third party"; seeing that nobody else is on it
// says "probably a typo in the name or the number" — the `044…`/`014…` near-miss being
// the likely example.

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
  PAYOUT_ACCOUNT_REVIEW_FILTER,
  PAYOUT_ACCOUNT_REVIEW_FILTER_ALL,
  PAYOUT_ACCOUNT_SHARED_WITH_PREFIX,
  PAYOUT_ACCOUNT_SHARED_WITH_NOBODY,
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

const flagged = (over: Partial<ManagedWorker> = {}): ManagedWorker => ({
  ...BASE,
  payoutAccount: { state: "unrecorded", isShared: true, nameMatches: false, sharedWith: [] },
  ...over,
});

const openEditSheet = (name: RegExp | string = /^แก้ไข/) =>
  fireEvent.click(screen.getByRole("button", { name }));
const sheet = () => screen.getByRole("dialog");

describe("WorkerRosterManager — spec 395 U4, working the flagged accounts", () => {
  it("offers a counted filter for the accounts needing review", () => {
    render(
      <WorkerRosterManager
        workers={[flagged({ id: "a", name: "ก" }), flagged({ id: "b", name: "ข" }), BASE]}
        contractors={[]}
      />,
    );
    expect(
      screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (2)` }),
    ).toBeInTheDocument();
  });

  it("narrows the roster to just those rows", () => {
    render(
      <WorkerRosterManager
        workers={[flagged({ id: "a", name: "ต้องตรวจ" }), { ...BASE, id: "b", name: "ปกติดี" }]}
        contractors={[]}
      />,
    );
    expect(screen.getByText("ปกติดี")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` }));
    expect(screen.getByText("ต้องตรวจ")).toBeInTheDocument();
    expect(screen.queryByText("ปกติดี")).not.toBeInTheDocument();
  });

  // ⚠️ Its OWN radiogroup. The existing chips filter by การจ่าย — a different axis — and
  // folding this in would mean you cannot review accounts *and* keep a pay-type filter,
  // and would silently clear the other selection.
  // ⚠️ Asserts BOTH review chips, not just one. A mutation renaming only the "ทุกบัญชี"
  // chip into the pay group survived a check that looked at "บัญชีต้องตรวจสอบ" alone —
  // and that half-migrated state is the actually-broken one: the two review options
  // would sit in different groups, so neither could turn the other off.
  it("is a separate axis from the การจ่าย chips — both of its chips", () => {
    render(<WorkerRosterManager workers={[flagged()]} contractors={[]} />);
    const reviewOn = screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` });
    const reviewOff = screen.getByRole("radio", {
      name: `${PAYOUT_ACCOUNT_REVIEW_FILTER_ALL} (1)`,
    });
    const payAll = screen.getByRole("radio", { name: /^ทั้งหมด/ });

    const group = reviewOn.getAttribute("name");
    // The two review options must be ONE group, or selecting either cannot clear the other.
    expect(reviewOff.getAttribute("name")).toBe(group);
    // …and that group must not be the pay-type one.
    expect(group).not.toBe(payAll.getAttribute("name"));
  });

  // ⚠️ Two adjacent chip rows both opening with "ทั้งหมด (N)" is ambiguous on screen —
  // the reader cannot tell which axis they just cleared, and `getByRole` cannot either.
  // The review row names its axis instead.
  it("does not duplicate the การจ่าย row's ทั้งหมด chip", () => {
    render(<WorkerRosterManager workers={[flagged()]} contractors={[]} />);
    // Exactly one radio opens with ทั้งหมด — the การจ่าย row's. The review row names
    // its own axis instead.
    expect(screen.getAllByRole("radio", { name: /^ทั้งหมด/ })).toHaveLength(1);
    expect(
      screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER_ALL} (1)` }),
    ).toBeInTheDocument();
  });

  // ⚠️ The fact that decides the row. Three OTHER technicians on one account reads
  // "third party"; nobody else reads "probably a typo".
  it("names the other workers on the same account, in the sheet", () => {
    render(
      <WorkerRosterManager
        workers={[
          flagged({
            id: "x",
            name: "นางสาว โนรี ทิพย์โภชน์",
            payoutAccount: {
              state: "unrecorded",
              isShared: true,
              nameMatches: false,
              sharedWith: ["นาย พิเชษฐ์ พันธุพัฒน์", "นายสายฟ้า บุญเกิด"],
            },
          }),
        ]}
        contractors={[]}
      />,
    );
    openEditSheet();
    const line = within(sheet()).getByText(
      new RegExp(`${PAYOUT_ACCOUNT_SHARED_WITH_PREFIX}.*พิเชษฐ์.*สายฟ้า`),
    );
    expect(line).toBeInTheDocument();
  });

  // The near-miss case: flagged on a NAME mismatch with nobody else on the account.
  // Saying so is what points the reviewer at a correction instead of a nominee.
  it("says explicitly when nobody else uses the account", () => {
    render(
      <WorkerRosterManager
        workers={[
          flagged({
            payoutAccount: {
              state: "unrecorded",
              isShared: false,
              nameMatches: false,
              sharedWith: [],
            },
          }),
        ]}
        contractors={[]}
      />,
    );
    openEditSheet();
    expect(within(sheet()).getByText(PAYOUT_ACCOUNT_SHARED_WITH_NOBODY)).toBeInTheDocument();
  });

  // ⚠️ EVERY test below covers a 🔴 found in review. The unit shipped with zero filter-
  // INTERACTION coverage, and all four blank-page paths lived in exactly that gap.

  // The 2026-08-04 duplicate-เลขบัตร fix hands back the colliding ช่าง's name and searches
  // for it to put their row on screen. With a latched review filter and that worker not
  // flagged, the row never appears and the refusal points at nobody.
  // ⚠️ The search term must match BOTH a flagged and an unflagged worker. A term matching
  // only the unflagged one drives `flaggedCount` to 0, which switches the filter off via a
  // DIFFERENT clause — so the mutant that removes `!searching` survives and the test proves
  // nothing. (Found by exactly that surviving mutant.)
  it("lets a live search override the filter, as the การจ่าย chip already does", () => {
    render(
      <WorkerRosterManager
        workers={[
          flagged({ id: "a", name: "สมชาย ต้องตรวจ" }),
          { ...BASE, id: "b", name: "สมชาย ปกติดี" },
        ]}
        contractors={[]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` }));
    expect(screen.queryByText("สมชาย ปกติดี")).not.toBeInTheDocument();

    // "สมชาย" matches both, so flaggedCount stays 1 — only `!searching` can let the
    // unflagged row back in.
    fireEvent.change(screen.getByLabelText("ค้นหาช่าง"), { target: { value: "สมชาย" } });
    expect(screen.getByText("สมชาย ปกติดี")).toBeInTheDocument();
    expect(screen.getByText("สมชาย ต้องตรวจ")).toBeInTheDocument();
  });

  // The COMPLETION path: the reviewer fixes the last flagged worker, the list refreshes,
  // and a latched filter would leave them on an empty roster with no control to undo it.
  it("releases the filter when the last flagged worker is resolved", () => {
    const { rerender } = render(
      <WorkerRosterManager workers={[flagged({ id: "a", name: "ต้องตรวจ" })]} contractors={[]} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` }));

    rerender(
      <WorkerRosterManager
        workers={[{ ...BASE, id: "a", name: "ต้องตรวจ", payoutAccount: null }]}
        contractors={[]}
      />,
    );
    // The roster is visible again, not blank.
    expect(screen.getByText("ต้องตรวจ")).toBeInTheDocument();
  });

  // Wrong-cause copy: the search DID match; the review filter is what hid the row.
  it("names the review filter, not the search, when the filter is what emptied the list", () => {
    render(
      <WorkerRosterManager
        workers={[flagged({ id: "a", name: "ต้องตรวจ" }), { ...BASE, id: "b", name: "ปกติดี" }]}
        contractors={[]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` }));
    expect(screen.queryByText("ไม่พบช่างที่ค้นหา")).toBeNull();
  });

  // ⚠️ Review filter × a การจ่าย chip that the filter has emptied. Without the fallback,
  // `sections` becomes [] — a blank page with no message and no chip appearing checked,
  // because `present` no longer contains the selected group. I fixed this in review and
  // then shipped it untested; the surviving mutant is what said so.
  it("does not go blank when the chosen การจ่าย group holds no flagged rows", () => {
    render(
      <WorkerRosterManager
        workers={[
          flagged({ id: "a", name: "รายเดือนต้องตรวจ", pay_type: "monthly" }),
          { ...BASE, id: "b", name: "รายวันปกติ", pay_type: "daily" },
        ]}
        contractors={[]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /^ช่างรายวัน/ }));
    expect(screen.getByText("รายวันปกติ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` }));
    // The only flagged worker is monthly — it must still be shown, not swallowed by a
    // pay chip that no longer matches anything.
    expect(screen.getByText("รายเดือนต้องตรวจ")).toBeInTheDocument();
  });

  // ⚠️ A predicate mutated to `payoutAccount != null` survived the whole file, because
  // every unflagged fixture used `null`. `own` and `nominee` must NOT count.
  it("counts only unrecorded — own and nominee rows are not work", () => {
    render(
      <WorkerRosterManager
        workers={[
          flagged({ id: "a", name: "ก" }),
          {
            ...BASE,
            id: "b",
            name: "ข",
            payoutAccount: { state: "own", isShared: false, nameMatches: true, sharedWith: [] },
          },
          {
            ...BASE,
            id: "c",
            name: "ค",
            payoutAccount: {
              state: "nominee",
              isShared: true,
              nameMatches: false,
              sharedWith: ["ง"],
            },
          },
        ]}
        contractors={[]}
      />,
    );
    expect(
      screen.getByRole("radio", { name: `${PAYOUT_ACCOUNT_REVIEW_FILTER} (1)` }),
    ).toBeInTheDocument();
  });

  it("shows no review filter at all when nothing is flagged", () => {
    render(<WorkerRosterManager workers={[BASE]} contractors={[]} />);
    expect(
      screen.queryByRole("radio", { name: new RegExp(PAYOUT_ACCOUNT_REVIEW_FILTER) }),
    ).toBeNull();
  });
});
