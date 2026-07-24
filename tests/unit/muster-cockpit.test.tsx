// Writing failing test first.
//
// Spec 306 U3 — the muster cockpit. The SA forms teams at the morning talk and
// checks members in/out. Pins (the browser-verifiable manual path; the camera
// scan is BarcodeDetector, device-verified, hidden in jsdom):
// - renders each team's lead + members with their check-in state;
// - the เข้า/ออก mode toggle flips which action the member rows offer;
// - opening a team calls openMusterTeam with the picked lead;
// - tap-adding a worker (เข้า mode) calls musterScan mode:"in" method:"manual";
// - checking a present member out (ออก mode) calls musterScan mode:"out";
// - editing the WP set calls setMusterTeamWps.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openMusterTeam = vi.fn();
const musterScan = vi.fn();
const setMusterTeamWps = vi.fn();
const closeMusterDay = vi.fn();
vi.mock("@/lib/muster/actions", () => ({
  openMusterTeam: (...a: unknown[]) => openMusterTeam(...a),
  musterScan: (...a: unknown[]) => musterScan(...a),
  setMusterTeamWps: (...a: unknown[]) => setMusterTeamWps(...a),
  closeMusterDay: (...a: unknown[]) => closeMusterDay(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { MusterCockpit } from "@/components/features/muster/muster-cockpit";
import type { MusterBoard } from "@/lib/muster/load-muster";
import { MUSTER_DAY_CLOSED_LABEL } from "@/lib/i18n/labels";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const W1 = "aaaaaaaa-1111-1111-1111-111111111111";
const W2 = "bbbbbbbb-2222-2222-2222-222222222222";
const W3 = "cccccccc-3333-3333-3333-333333333333";
const T1 = "dddddddd-4444-4444-4444-444444444444";
const WPA = "eeeeeeee-5555-5555-5555-555555555555";

const BOARD: MusterBoard = {
  teams: [
    {
      id: T1,
      leadWorkerId: W1,
      leadName: "ลี",
      members: [
        {
          workerId: W1,
          name: "ลี",
          inAt: "2026-07-13T01:00:00Z",
          outAt: null,
          ot: null,
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
  wps: [{ id: WPA, code: "A", name: "งานเอ" }],
  closure: null,
};

function renderCockpit(board: MusterBoard = BOARD, pastDayEnd = false) {
  return render(
    <MusterCockpit
      projectId={PROJECT}
      date="2026-07-13"
      revalidate="/projects/x/muster"
      board={board}
      pastDayEnd={pastDayEnd}
      // Pre-334-follow-up semantics for the legacy cases: every fixture worker
      // is an HT, so these tests keep exercising the non-filter behaviour.
      htWorkerIds={board.workers.map((w) => w.id)}
    />,
  );
}

beforeEach(() => {
  openMusterTeam.mockResolvedValue({ ok: true, id: "new" });
  musterScan.mockResolvedValue({ ok: true, id: "att" });
  setMusterTeamWps.mockResolvedValue({ ok: true });
  closeMusterDay.mockResolvedValue({ ok: true });
});

describe("MusterCockpit", () => {
  it("renders the team with its lead and member", () => {
    renderCockpit();
    // "ลี" is both the lead (header) and a checked-in member (row).
    expect(screen.getAllByText("ลี").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId(`team-${T1}`)).toBeInTheDocument();
  });

  it("opens a new team with the picked lead", async () => {
    const user = userEvent.setup();
    renderCockpit();
    // Pick ก้อง (not already a lead) as a new team lead.
    await user.selectOptions(screen.getByLabelText("เลือกหัวหน้าทีม"), W3);
    await user.click(screen.getByRole("button", { name: "เปิดทีม" }));
    expect(openMusterTeam).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, date: "2026-07-13", leadWorkerId: W3 }),
    );
  });

  it("tap-adds a worker to a team in เข้า mode (method manual)", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /เพิ่มช่าง/ }));
    await user.click(within(team).getByRole("button", { name: "สมชาย" }));
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, workerId: W2, mode: "in", method: "manual" }),
    );
  });

  it("checks a present member out in ออก mode", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("button", { name: "ออก" }));
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /เช็คออก/ }));
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, workerId: W1, mode: "out", method: "manual" }),
    );
  });

  it("closes the day after an inline confirm", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("button", { name: "ปิดวัน" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันปิดวัน" }));
    expect(closeMusterDay).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, date: "2026-07-13" }),
    );
  });

  it("shows the closed banner when the day is already closed", () => {
    renderCockpit({ ...BOARD, closure: { closedAt: "2026-07-13T10:00:00Z" } });
    // Spec 334 U1 — pin the closed banner to the SSOT const, not a retyped literal.
    expect(screen.getByText(new RegExp(MUSTER_DAY_CLOSED_LABEL))).toBeInTheDocument();
  });

  it("saves an edited WP set for a team", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    await user.click(within(team).getByLabelText(/งานเอ/));
    await user.click(within(team).getByRole("button", { name: "บันทึกงาน" }));
    expect(setMusterTeamWps).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, wpIds: [WPA] }),
    );
  });
});

// Spec 351 U2 — the OT session. A worker's normal hours and OT are two separate
// scan sessions; the cockpit gains a งานปกติ/OT session toggle, per-member OT
// scan controls (OT เข้า when no OT yet, OT ออก while OT is open), an OT-span
// line, and an "OT ยังไม่ปิด" flag for an OT session left open.
describe("MusterCockpit — OT session (spec 351)", () => {
  const OT_BOARD: MusterBoard = {
    teams: [
      {
        id: T1,
        leadWorkerId: W1,
        leadName: "ลี",
        members: [
          // W1 — regular done, NO ot yet → eligible for OT เข้า.
          {
            workerId: W1,
            name: "ลี",
            inAt: "2026-07-13T01:00:00Z",
            outAt: "2026-07-13T09:00:00Z",
            ot: null,
            outAuto: false,
          },
          // W2 — regular done, OT OPEN (in, no out) → OT ออก + the ยังไม่ปิด flag.
          {
            workerId: W2,
            name: "สมชาย",
            inAt: "2026-07-13T01:00:00Z",
            outAt: "2026-07-13T09:00:00Z",
            ot: { inAt: "2026-07-13T10:30:00Z", outAt: null, otHours: null },
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
    wps: [{ id: WPA, code: "A", name: "งานเอ" }],
    closure: null,
  };

  it("shows an OT-span line and the open-OT flag for a member with OT open", () => {
    renderCockpit(OT_BOARD);
    // The open OT session surfaces its ยังไม่ปิด flag (independent of the toggle).
    expect(screen.getByText(/OT ยังไม่ปิด/)).toBeInTheDocument();
  });

  it("in OT session, offers OT ออก for an open-OT member and calls scan session:'ot' mode:'out'", async () => {
    const user = userEvent.setup();
    renderCockpit(OT_BOARD);
    await user.click(screen.getByRole("button", { name: "OT" }));
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: "OT ออก" }));
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: T1,
        workerId: W2,
        mode: "out",
        session: "ot",
        method: "manual",
      }),
    );
  });

  it("in OT session, offers OT เข้า for a member with no OT yet and calls scan session:'ot' mode:'in'", async () => {
    const user = userEvent.setup();
    renderCockpit(OT_BOARD);
    await user.click(screen.getByRole("button", { name: "OT" }));
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: "OT เข้า" }));
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: T1,
        workerId: W1,
        mode: "in",
        session: "ot",
        method: "manual",
      }),
    );
  });

  it("the regular in-mode add still threads session:'regular'", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /เพิ่มช่าง/ }));
    await user.click(within(team).getByRole("button", { name: "สมชาย" }));
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, workerId: W2, mode: "in", session: "regular" }),
    );
  });
});

// Spec 334 follow-up (operator 2026-07-21): หัวหน้าทีม can only be an HT — a worker
// who leads a crew (crews.lead_worker_id, the spec 330/332 headship axis). The
// picker must not offer the whole roster.
describe("lead picker — HT only", () => {
  it("offers only htWorkerIds (minus already-leading), not every worker", () => {
    render(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-13"
        revalidate="/projects/x/muster"
        board={BOARD}
        pastDayEnd={false}
        htWorkerIds={[W1, W2]}
      />,
    );
    const select = screen.getByLabelText("เลือกหัวหน้าทีม");
    const names = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    // W1 ลี already leads the fixture team; W3 ก้อง is not an HT → only สมชาย.
    expect(names).toContain("สมชาย");
    expect(names).not.toContain("ก้อง");
    expect(names).not.toContain("ลี");
  });

  it("no HT in the project → guidance message instead of an empty opener", () => {
    render(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-13"
        revalidate="/projects/x/muster"
        board={{ ...BOARD, teams: [] }}
        pastDayEnd={false}
        htWorkerIds={[]}
      />,
    );
    expect(screen.getByText(/ยังไม่มีหัวหน้าทีม/)).toBeInTheDocument();
    expect(screen.queryByLabelText("เลือกหัวหน้าทีม")).not.toBeInTheDocument();
  });
});

it("HT exists but is not on the active roster (deactivated lead) → guidance, not a dead picker", () => {
  render(
    <MusterCockpit
      projectId={PROJECT}
      date="2026-07-13"
      revalidate="/projects/x/muster"
      board={{ ...BOARD, teams: [] }}
      pastDayEnd={false}
      htWorkerIds={["ghost-not-in-workers"]}
    />,
  );
  expect(screen.getByText(/ยังไม่มีหัวหน้าทีม/)).toBeInTheDocument();
  expect(screen.queryByLabelText("เลือกหัวหน้าทีม")).not.toBeInTheDocument();
});

// Spec 306 grain-coverage — teams assign per LEAF (งานย่อย) WP so the close-day
// derive can bind labor_logs. A project has hundreds of leaves under a few dozen
// งาน, so the picker groups them: each parent งาน is a collapsible header, its
// leaves hidden until expanded; standalone leaf main-WPs render directly.
describe("MusterCockpit — leaf WP picker (spec 306 grain-coverage)", () => {
  const WPB = "99999999-9999-9999-9999-999999999999";
  const PARENT = "ffffffff-6666-6666-6666-666666666666";
  const GROUPED: MusterBoard = {
    ...BOARD,
    teams: [{ ...BOARD.teams[0]!, wpIds: [] }],
    wps: [
      { id: WPA, code: "A", name: "งานเอ", parentId: null, parentCode: null, parentName: null },
      {
        id: WPB,
        code: "W05-01",
        name: "ปูพื้น",
        parentId: PARENT,
        parentCode: "WP-05",
        parentName: "งานพื้น",
      },
    ],
  };

  it("hides a งานย่อย under its parent งาน until the group is expanded, then saves the leaf", async () => {
    const user = userEvent.setup();
    renderCockpit(GROUPED);
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    // Standalone leaf renders directly; the grouped leaf is collapsed (not rendered).
    expect(within(team).getByLabelText(/งานเอ/)).toBeInTheDocument();
    expect(within(team).queryByLabelText(/ปูพื้น/)).not.toBeInTheDocument();
    // Expand the parent งาน group → the child checkbox appears, then check + save.
    await user.click(within(team).getByRole("button", { name: /งานพื้น/ }));
    await user.click(within(team).getByLabelText(/ปูพื้น/));
    await user.click(within(team).getByRole("button", { name: "บันทึกงาน" }));
    expect(setMusterTeamWps).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, wpIds: [WPB] }),
    );
  });

  it("auto-expands a งาน group that already has a checked child", async () => {
    const user = userEvent.setup();
    renderCockpit({ ...GROUPED, teams: [{ ...GROUPED.teams[0]!, wpIds: [WPB] }] });
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    // The already-checked child is visible without a manual expand.
    expect(within(team).getByLabelText(/ปูพื้น/)).toBeInTheDocument();
  });

  it("drops a stuck assignment that is no longer a selectable leaf when saving", async () => {
    // A group/legacy WP id can sit in team.wpIds from the pre-change main-WP picker
    // (e.g. a stale bundle assigns one during a deploy). It has no checkbox in the
    // leaf picker, so it can never be unchecked; saving must not re-persist it.
    const user = userEvent.setup();
    const STALE = "88888888-8888-8888-8888-888888888888";
    renderCockpit({ ...GROUPED, teams: [{ ...GROUPED.teams[0]!, wpIds: [STALE, WPA] }] });
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    await user.click(within(team).getByRole("button", { name: "บันทึกงาน" }));
    expect(setMusterTeamWps).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, wpIds: [WPA] }),
    );
  });
});

describe("MusterCockpit — สแกน QR button gate (spec 306 U3b iOS fallback)", () => {
  // jsdom has neither BarcodeDetector nor mediaDevices — the baseline device
  // that genuinely cannot scan.
  it("no camera capability at all → no scan button", () => {
    renderCockpit();
    expect(screen.queryByRole("button", { name: "สแกน QR" })).not.toBeInTheDocument();
  });

  it("getUserMedia without BarcodeDetector (iPhone) → scan button renders", () => {
    // The day-1 gap: the pilot SA's iPhone has a camera but no BarcodeDetector,
    // and the button never rendered. The gate must key on overall scanner
    // support (native OR jsQR fallback), not on BarcodeDetector alone.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    try {
      renderCockpit();
      expect(screen.getByRole("button", { name: "สแกน QR" })).toBeInTheDocument();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });
});

describe("MusterCockpit — ปิดวัน sticky bar states (spec 306 discoverability)", () => {
  const READY_BOARD: MusterBoard = {
    ...BOARD,
    teams: [
      {
        id: T1,
        leadWorkerId: W1,
        leadName: "ลี",
        members: [
          {
            workerId: W1,
            name: "ลี",
            inAt: "2026-07-13T01:00:00Z",
            outAt: "2026-07-13T10:00:00Z",
            ot: null,
            outAuto: false,
          },
        ],
        wpIds: [],
      },
    ],
  };

  it("workers still in → in_progress nudge with the still-in count", () => {
    renderCockpit(); // BOARD: W1 in, not out
    expect(screen.getByText(/ยังมีช่างในงาน 1 คน/)).toBeInTheDocument();
  });

  it("team opened but nobody scanned in yet → neutral label, not 'ยังมีช่างในงาน 0 คน'", () => {
    const NO_SCAN: MusterBoard = {
      ...BOARD,
      teams: [{ id: T1, leadWorkerId: W1, leadName: "ลี", members: [], wpIds: [] }],
    };
    renderCockpit(NO_SCAN);
    expect(screen.getByText(/ยังไม่มีช่างเช็คอิน/)).toBeInTheDocument();
    expect(screen.queryByText(/ยังมีช่างในงาน 0 คน/)).not.toBeInTheDocument();
  });

  it("all checked out → the 'done' highlight nudges to close for wages", () => {
    renderCockpit(READY_BOARD);
    expect(screen.getByText(/ทุกคนเช็คออกแล้ว/)).toBeInTheDocument();
  });

  it("past day-end with workers still in → overdue reminder", () => {
    renderCockpit(BOARD, true);
    expect(screen.getByText(/เลยเวลาเลิกงาน/)).toBeInTheDocument();
  });

  it("closing is a positive action — the confirm button is primary, never danger", async () => {
    const user = userEvent.setup();
    renderCockpit(READY_BOARD);
    await user.click(screen.getByRole("button", { name: "ปิดวัน" }));
    const confirm = screen.getByRole("button", { name: "ยืนยันปิดวัน" });
    expect(confirm).toHaveClass("bg-fill");
    expect(confirm).not.toHaveClass("bg-danger");
  });

  it("confirming with an OT session still open warns that OT will not be recorded", async () => {
    const user = userEvent.setup();
    const OT_OPEN: MusterBoard = {
      ...BOARD,
      teams: [
        {
          id: T1,
          leadWorkerId: W1,
          leadName: "ลี",
          members: [
            {
              workerId: W1,
              name: "ลี",
              inAt: "2026-07-13T01:00:00Z",
              outAt: "2026-07-13T10:00:00Z",
              ot: { inAt: "2026-07-13T10:30:00Z", outAt: null, otHours: null },
              outAuto: false,
            },
          ],
          wpIds: [],
        },
      ],
    };
    renderCockpit(OT_OPEN);
    await user.click(screen.getByRole("button", { name: "ปิดวัน" }));
    expect(screen.getByText(/ยัง OT ไม่ปิด/)).toBeInTheDocument();
  });
});
