// Writing failing test first.
//
// Spec 306 (deferred move-on-conflict UI, built 2026-07-19) — the cockpit's
// member rows gain a ย้าย (move-team) correction: visible in เข้า mode when the
// board has 2+ teams, it opens an inline picker of the OTHER teams (by lead
// name); picking one calls moveMusterWorker(workerId, date, toTeamId). Single-
// team boards show no move affordance (nowhere to move to).

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openMusterTeam = vi.fn();
const musterScan = vi.fn();
const setMusterTeamWps = vi.fn();
const closeMusterDay = vi.fn();
const moveMusterWorker = vi.fn();
vi.mock("@/lib/muster/actions", () => ({
  openMusterTeam: (...a: unknown[]) => openMusterTeam(...a),
  musterScan: (...a: unknown[]) => musterScan(...a),
  setMusterTeamWps: (...a: unknown[]) => setMusterTeamWps(...a),
  closeMusterDay: (...a: unknown[]) => closeMusterDay(...a),
  moveMusterWorker: (...a: unknown[]) => moveMusterWorker(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { MusterCockpit } from "@/components/features/muster/muster-cockpit";
import type { MusterBoard } from "@/lib/muster/load-muster";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const W1 = "aaaaaaaa-1111-1111-1111-111111111111";
const W2 = "bbbbbbbb-2222-2222-2222-222222222222";
const W3 = "cccccccc-3333-3333-3333-333333333333";
const T1 = "dddddddd-4444-4444-4444-444444444444";
const T2 = "eeeeeeee-5555-5555-5555-555555555555";
const DATE = "2026-07-19";

const TWO_TEAMS: MusterBoard = {
  teams: [
    {
      id: T1,
      leadWorkerId: W1,
      leadName: "ลี",
      members: [
        {
          workerId: W1,
          name: "ลี",
          inAt: "2026-07-19T01:00:00Z",
          outAt: null,
          otHours: null,
          outAuto: false,
        },
        {
          workerId: W3,
          name: "ก้อง",
          inAt: "2026-07-19T01:05:00Z",
          outAt: null,
          otHours: null,
          outAuto: false,
        },
      ],
      wpIds: [],
    },
    {
      id: T2,
      leadWorkerId: W2,
      leadName: "สมชาย",
      members: [
        {
          workerId: W2,
          name: "สมชาย",
          inAt: "2026-07-19T01:02:00Z",
          outAt: null,
          otHours: null,
          outAuto: false,
        },
      ],
      wpIds: [],
    },
  ],
  workers: [
    { id: W1, name: "ลี" },
    { id: W2, name: "สมชาย" },
    { id: W3, name: "ก้อง" },
  ],
  wps: [],
  closure: null,
};

const ONE_TEAM: MusterBoard = {
  ...TWO_TEAMS,
  teams: [TWO_TEAMS.teams[0]!],
};

function renderCockpit(board: MusterBoard) {
  return render(
    <MusterCockpit
      projectId={PROJECT}
      date={DATE}
      revalidate="/projects/x/muster"
      board={board}
      htWorkerIds={board.workers.map((w) => w.id)}
    />,
  );
}
beforeEach(() => {
  openMusterTeam.mockReset().mockResolvedValue({ ok: true, id: "new" });
  musterScan.mockReset().mockResolvedValue({ ok: true, id: "att" });
  setMusterTeamWps.mockReset().mockResolvedValue({ ok: true });
  closeMusterDay.mockReset().mockResolvedValue({ ok: true });
  moveMusterWorker.mockReset().mockResolvedValue({ ok: true, id: "att" });
});

describe("MusterCockpit — move worker between teams", () => {
  it("shows a ย้าย control on member rows when 2+ teams exist", () => {
    renderCockpit(TWO_TEAMS);
    const team1 = within(screen.getByTestId(`team-${T1}`));
    expect(team1.getAllByRole("button", { name: "ย้าย" }).length).toBeGreaterThan(0);
  });

  it("hides the ย้าย control on a single-team board", () => {
    renderCockpit(ONE_TEAM);
    expect(screen.queryByRole("button", { name: "ย้าย" })).not.toBeInTheDocument();
  });

  it("an open move picker does not survive flipping to ออก mode", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAMS);
    const team1 = within(screen.getByTestId(`team-${T1}`));
    const kongRow = team1.getByText("ก้อง").closest("li")!;
    await user.click(within(kongRow as HTMLElement).getByRole("button", { name: "ย้าย" }));
    expect(screen.getByText("ย้ายไปทีมของ:")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ออก" }));
    expect(screen.queryByText("ย้ายไปทีมของ:")).not.toBeInTheDocument();
  });

  it("picking a target team calls moveMusterWorker with worker + date + team", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAMS);
    const team1 = within(screen.getByTestId(`team-${T1}`));
    // ก้อง's row → ย้าย → picker lists the OTHER team by lead name (สมชาย).
    const kongRow = team1.getByText("ก้อง").closest("li")!;
    await user.click(within(kongRow as HTMLElement).getByRole("button", { name: "ย้าย" }));
    await user.click(screen.getByRole("button", { name: /สมชาย/ }));
    expect(moveMusterWorker).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: W3, date: DATE, toTeamId: T2 }),
    );
  });
});
