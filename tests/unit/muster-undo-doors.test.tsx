// Writing failing test first.
//
// Spec 379 U2 — the two undo doors on the cockpit:
//
//  1. the SWEEP TALLY row — wrong person, three seconds ago, sheet still open;
//  2. the TEAM-CARD MEMBER row — the same repair, found later.
//
// Both are two-tap (this deletes an attendance record) and both must name the
// retraction, not a check-out: "they left" and "they were never here" are
// different claims about a person's day.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openMusterTeam = vi.fn();
const musterScan = vi.fn();
const setMusterTeamWps = vi.fn();
const closeMusterDay = vi.fn();
const moveMusterWorker = vi.fn();
const closeOpenOt = vi.fn();
const undoMusterScan = vi.fn();
vi.mock("@/lib/muster/actions", () => ({
  openMusterTeam: (...a: unknown[]) => openMusterTeam(...a),
  musterScan: (...a: unknown[]) => musterScan(...a),
  setMusterTeamWps: (...a: unknown[]) => setMusterTeamWps(...a),
  closeMusterDay: (...a: unknown[]) => closeMusterDay(...a),
  moveMusterWorker: (...a: unknown[]) => moveMusterWorker(...a),
  closeOpenOt: (...a: unknown[]) => closeOpenOt(...a),
  undoMusterScan: (...a: unknown[]) => undoMusterScan(...a),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/features/muster/muster-camera", () => ({
  MusterCamera: () => null,
}));

import { MusterCockpit } from "@/components/features/muster/muster-cockpit";
import {
  MUSTER_UNDO_CONFIRM_LABEL,
  MUSTER_UNDO_LABEL,
} from "@/components/features/muster/muster-add-sheet";
import type { MusterBoard } from "@/lib/muster/load-muster";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const W1 = "aaaaaaaa-1111-1111-1111-111111111111";
const W2 = "bbbbbbbb-2222-2222-2222-222222222222";
const W3 = "cccccccc-3333-3333-3333-333333333333";
const T1 = "dddddddd-4444-4444-4444-444444444444";
const T2 = "eeeeeeee-5555-5555-5555-555555555555";
const W4 = "ffffffff-6666-6666-6666-666666666666";
const DATE = "2026-07-30";

function board(over: Partial<MusterBoard> = {}): MusterBoard {
  return {
    teams: [
      {
        id: T1,
        leadWorkerId: W1,
        leadName: "ลี",
        members: [
          {
            workerId: W1,
            name: "ลี",
            gender: null,
            inAt: "2026-07-30T01:00:00Z",
            outAt: null,
            ot: null,
            outAuto: false,
          },
          {
            workerId: W3,
            name: "ก้อง",
            gender: null,
            inAt: "2026-07-30T01:05:00Z",
            outAt: null,
            ot: null,
            outAuto: false,
          },
        ],
        wpIds: [],
        prefillWpIds: [],
        missing: [],
      },
    ],
    workers: [
      { id: W1, name: "ลี", gender: null },
      { id: W2, name: "สมชาย", gender: null },
      { id: W3, name: "ก้อง", gender: null },
    ],
    wps: [],
    closure: null,
    priorTeamByWorker: [],
    ...over,
  };
}

function renderCockpit(b: MusterBoard = board()) {
  return render(
    <MusterCockpit
      projectId={PROJECT}
      date={DATE}
      revalidate="/projects/x/muster"
      board={b}
      pastDayEnd={false}
      htWorkerIds={b.workers.map((w) => w.id)}
    />,
  );
}

beforeEach(() => {
  openMusterTeam.mockReset().mockResolvedValue({ ok: true, id: "new" });
  musterScan.mockReset().mockResolvedValue({ ok: true, id: "att" });
  setMusterTeamWps.mockReset().mockResolvedValue({ ok: true });
  closeMusterDay.mockReset().mockResolvedValue({ ok: true });
  moveMusterWorker.mockReset().mockResolvedValue({ ok: true, id: "moved" });
  closeOpenOt.mockReset().mockResolvedValue({ ok: true, closed: 1 });
  undoMusterScan.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

async function openSheetAndAdd(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const team = screen.getByTestId(`team-${T1}`);
  await user.click(within(team).getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
  const sheet = screen.getByRole("dialog");
  await user.click(within(sheet).getByRole("button", { name }));
  return sheet;
}

describe("undo door 1 — the sweep tally row", () => {
  it("offers the retraction on a row that WROTE, and never calls it on the first tap", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const sheet = await openSheetAndAdd(user, "สมชาย");
    const tally = within(sheet).getByTestId("sweep-tally");

    const undo = within(tally).getByRole("button", { name: MUSTER_UNDO_LABEL });
    await user.click(undo);
    expect(undoMusterScan).not.toHaveBeenCalled();
    // The same control, now armed — a second deliberate press, not a new target.
    expect(within(tally).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL })).toBeVisible();
  });

  it("retracts the regular session on the second tap and folds the tally", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const sheet = await openSheetAndAdd(user, "สมชาย");
    const tally = within(sheet).getByTestId("sweep-tally");
    expect(within(tally).getByTestId("sweep-count")).toHaveTextContent("เพิ่มแล้ว 1 คน");

    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));

    expect(undoMusterScan).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: W2, date: DATE, session: "regular" }),
    );
    // The count is the SA's receipt — a retracted add must leave it.
    expect(within(tally).getByTestId("sweep-count")).toHaveTextContent("เพิ่มแล้ว 0 คน");
    expect(within(tally).getByText("ยกเลิกแล้ว")).toBeVisible();
    // …and the row stops offering the retraction it already performed.
    expect(within(tally).queryByRole("button", { name: MUSTER_UNDO_LABEL })).toBeNull();
  });

  it("does not offer a retraction on a row that wrote nothing", async () => {
    const user = userEvent.setup();
    // นิด is mustered on ANOTHER team today, so tapping her in this team's
    // sheet classifies `other_team` — no write, and therefore no attendance row
    // of this sweep's making to delete.
    const b = board();
    b.workers.push({ id: W4, name: "นิด", gender: null });
    b.teams.push({
      id: T2,
      leadWorkerId: W2,
      leadName: "สมชาย",
      members: [
        {
          workerId: W4,
          name: "นิด",
          gender: null,
          inAt: "2026-07-30T01:10:00Z",
          outAt: null,
          ot: null,
          outAuto: false,
        },
      ],
      wpIds: [],
      prefillWpIds: [],
      missing: [],
    });
    renderCockpit(b);
    const sheet = await openSheetAndAdd(user, /นิด/);
    const tally = within(sheet).getByTestId("sweep-tally");

    // The row IS actionable — just not by a retraction.
    expect(within(tally).getByRole("button", { name: "ย้ายมาทีมนี้" })).toBeVisible();
    expect(within(tally).queryByRole("button", { name: MUSTER_UNDO_LABEL })).toBeNull();
  });

  it("puts a refusal in front of the SA instead of silently keeping the row", async () => {
    const user = userEvent.setup();
    undoMusterScan.mockResolvedValue({ ok: false, error: "ปิดวันแล้ว — ยกเลิกไม่ได้" });
    renderCockpit();
    const sheet = await openSheetAndAdd(user, "สมชาย");
    const tally = within(sheet).getByTestId("sweep-tally");

    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));

    expect(within(sheet).getByRole("alert")).toHaveTextContent("ปิดวันแล้ว — ยกเลิกไม่ได้");
    // The write stands, so the count must not pretend otherwise.
    expect(within(tally).getByTestId("sweep-count")).toHaveTextContent("เพิ่มแล้ว 1 คน");
  });

  // Spec 379 §4 — episode state, and the test that actually DISCRIMINATES the
  // generation carry. `seq` restarts at 1 in every sweep, so a retraction that
  // lands after the SA has opened a new sheet would, without the carry, fold a
  // seq belonging to the DEAD sweep into the LIVE one — marking an innocent row
  // ยกเลิกแล้ว and releasing its id from addedRef, which lets the very next tap
  // write the same worker a second time. (Mutation-checked: the earlier
  // refresh-count assertions below pass with the carry removed; this one reds.)
  it("never folds a dead sweep's retraction into the sweep that replaced it", async () => {
    const user = userEvent.setup();
    let settle: (v: { ok: boolean }) => void = () => {};
    undoMusterScan.mockReturnValue(
      new Promise<{ ok: boolean }>((res) => {
        settle = res;
      }),
    );
    renderCockpit();
    const first = await openSheetAndAdd(user, "สมชาย");
    const firstTally = within(first).getByTestId("sweep-tally");
    await user.click(within(firstTally).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(firstTally).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));
    await user.click(within(first).getByRole("button", { name: "ปิด" }));

    // A fresh sweep, whose first entry carries the SAME seq the dead one did.
    const second = await openSheetAndAdd(user, "สมชาย");
    const secondTally = within(second).getByTestId("sweep-tally");
    expect(within(secondTally).getByTestId("sweep-count")).toHaveTextContent("เพิ่มแล้ว 1 คน");

    await act(async () => {
      settle({ ok: true });
    });

    expect(within(secondTally).getByTestId("sweep-count")).toHaveTextContent("เพิ่มแล้ว 1 คน");
    expect(within(secondTally).queryByText("ยกเลิกแล้ว")).toBeNull();
    // The live sweep still owns this worker — his tap row stays ticked and inert
    // rather than re-offering a second check-in for the same man.
    expect(within(second).getByRole("button", { name: /สมชาย/ })).toBeDisabled();
  });

  it("still puts a refusal on the page alert once the sheet has closed", async () => {
    const user = userEvent.setup();
    let settle: (v: { ok: boolean; error?: string }) => void = () => {};
    undoMusterScan.mockReturnValue(
      new Promise<{ ok: boolean; error?: string }>((res) => {
        settle = res;
      }),
    );
    renderCockpit();
    const sheet = await openSheetAndAdd(user, "สมชาย");
    const tally = within(sheet).getByTestId("sweep-tally");
    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));

    // The SA closes the sheet while the retraction is still in flight.
    await user.click(within(sheet).getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      settle({ ok: false, error: "ไม่พบการเช็คชื่อนี้" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("ไม่พบการเช็คชื่อนี้");
  });

  it("refreshes the board when a late retraction SUCCEEDS after the sheet closed", async () => {
    const user = userEvent.setup();
    let settle: (v: { ok: boolean }) => void = () => {};
    undoMusterScan.mockReturnValue(
      new Promise<{ ok: boolean }>((res) => {
        settle = res;
      }),
    );
    renderCockpit();
    const sheet = await openSheetAndAdd(user, "สมชาย");
    const tally = within(sheet).getByTestId("sweep-tally");
    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(tally).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));
    await user.click(within(sheet).getByRole("button", { name: "ปิด" }));
    // The closing refresh counted a worker the DB is about to stop holding.
    const onClose = refresh.mock.calls.length;

    await act(async () => {
      settle({ ok: true });
    });
    expect(refresh.mock.calls.length).toBeGreaterThan(onClose);
  });
});

describe("undo door 2 — the team-card member row", () => {
  it("retracts a member's regular check-in on the second tap", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const row = within(screen.getByTestId(`team-${T1}`)).getByTestId(`member-${W3}`);

    await user.click(within(row).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    expect(undoMusterScan).not.toHaveBeenCalled();
    await user.click(within(row).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));

    expect(undoMusterScan).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: W3, date: DATE, session: "regular" }),
    );
  });

  it("arms one row at a time — a second row's first tap disarms the first", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const team = screen.getByTestId(`team-${T1}`);
    const lee = within(team).getByTestId(`member-${W1}`);
    const kong = within(team).getByTestId(`member-${W3}`);

    await user.click(within(lee).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(kong).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    expect(within(lee).getByRole("button", { name: MUSTER_UNDO_LABEL })).toBeVisible();
    expect(within(kong).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL })).toBeVisible();
    expect(undoMusterScan).not.toHaveBeenCalled();
  });

  // Spec 379 D4 — the regular retraction REFUSES while an OT row survives
  // ("undo the OT session first"). That refusal names an action, so the action
  // has to exist: the OT round's own row carries it.
  it("retracts the OT session from the OT round, naming session:'ot'", async () => {
    const user = userEvent.setup();
    const b = board();
    b.teams[0]!.members[1]!.ot = { inAt: "2026-07-30T10:00:00Z", outAt: null, otHours: null };
    renderCockpit(b);
    await user.click(screen.getByRole("button", { name: "OT" }));
    const row = within(screen.getByTestId(`team-${T1}`)).getByTestId(`member-ot-${W3}`);

    await user.click(within(row).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(row).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));

    expect(undoMusterScan).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: W3, date: DATE, session: "ot" }),
    );
  });

  it("shows a refusal on the page alert", async () => {
    const user = userEvent.setup();
    undoMusterScan.mockResolvedValue({ ok: false, error: "ต้องยกเลิก OT ของช่างคนนี้ก่อน" });
    renderCockpit();
    const row = within(screen.getByTestId(`team-${T1}`)).getByTestId(`member-${W3}`);
    await user.click(within(row).getByRole("button", { name: MUSTER_UNDO_LABEL }));
    await user.click(within(row).getByRole("button", { name: MUSTER_UNDO_CONFIRM_LABEL }));
    expect(screen.getByRole("alert")).toHaveTextContent("ต้องยกเลิก OT ของช่างคนนี้ก่อน");
  });
});

describe("the retraction never reads like a check-out", () => {
  it("labels the control with a retraction, not เช็คออก", () => {
    expect(MUSTER_UNDO_LABEL).not.toContain("เช็คออก");
    expect(MUSTER_UNDO_LABEL).toContain("ยกเลิก");
    expect(MUSTER_UNDO_CONFIRM_LABEL).toContain("ยกเลิก");
  });
});
