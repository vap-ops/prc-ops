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

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// The camera loop is untestable in jsdom (getUserMedia/BarcodeDetector absent) —
// mock the component; the sheet's camera MOUNT decision + the onDetected wiring
// are what these tests pin. The trigger fires a fixed worker id (=W3 below;
// vi.mock hoists above the consts, so the literal is repeated here).
const nextScanId = { current: "cccccccc-3333-3333-3333-333333333333" };
vi.mock("@/components/features/muster/muster-camera", () => ({
  MusterCamera: (p: { onDetected: (id: string) => void }) => (
    <>
      <button
        type="button"
        data-testid="camera-mock"
        onClick={() => p.onDetected("cccccccc-3333-3333-3333-333333333333")}
      />
      <button
        type="button"
        data-testid="camera-mock-next"
        onClick={() => p.onDetected(nextScanId.current)}
      />
    </>
  ),
}));

import { MusterCockpit } from "@/components/features/muster/muster-cockpit";
import { MusterAddSheet } from "@/components/features/muster/muster-add-sheet";
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
          gender: null,
          inAt: "2026-07-13T01:00:00Z",
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
  wps: [{ id: WPA, code: "A", name: "งานเอ", status: "in_progress" }],
  closure: null,
  priorTeamByWorker: [],
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
  moveMusterWorker.mockResolvedValue({ ok: true, id: "moved" });
  moveMusterWorker.mockClear();
  // Spec 359 U1 — the sweep asserts on refresh CALL COUNT, so it must not leak
  // between tests.
  refresh.mockClear();
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

  it("tap-adds a worker through the team's scan/add sheet (method manual)", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "สมชาย" }));
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
            gender: null,
            inAt: "2026-07-13T01:00:00Z",
            outAt: "2026-07-13T09:00:00Z",
            ot: null,
            outAuto: false,
          },
          // W2 — regular done, OT OPEN (in, no out) → OT ออก + the ยังไม่ปิด flag.
          {
            workerId: W2,
            name: "สมชาย",
            gender: null,
            inAt: "2026-07-13T01:00:00Z",
            outAt: "2026-07-13T09:00:00Z",
            ot: { inAt: "2026-07-13T10:30:00Z", outAt: null, otHours: null },
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
    wps: [{ id: WPA, code: "A", name: "งานเอ", status: "in_progress" }],
    closure: null,
    priorTeamByWorker: [],
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

  it("the regular in-mode sheet tap-add still threads session:'regular'", async () => {
    const user = userEvent.setup();
    renderCockpit();
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "สมชาย" }));
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
    teams: [{ ...BOARD.teams[0]!, wpIds: [], prefillWpIds: [], missing: [] }],
    wps: [
      {
        id: WPA,
        code: "A",
        name: "งานเอ",
        status: "in_progress",
        parentId: null,
        parentCode: null,
        parentName: null,
      },
      {
        id: WPB,
        code: "W05-01",
        name: "ปูพื้น",
        status: "in_progress",
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

// Spec 357 U-B — the picker shows only incomplete leaves (an assigned-but-
// completed one stays, tagged) and an unassigned team's picker seeds from the
// same lead's prior muster day.
describe("MusterCockpit — picker incomplete filter + prior-day prefill (spec 357 U-B)", () => {
  const WPB = "99999999-9999-9999-9999-999999999999";
  const PARENT = "ffffffff-6666-6666-6666-666666666666";
  const STATUS_BOARD: MusterBoard = {
    ...BOARD,
    teams: [{ ...BOARD.teams[0]!, wpIds: [], prefillWpIds: [], missing: [] }],
    wps: [
      {
        id: WPA,
        code: "A",
        name: "งานเอ",
        status: "complete",
        parentId: null,
        parentCode: null,
        parentName: null,
      },
      {
        id: WPB,
        code: "W05-01",
        name: "ปูพื้น",
        status: "in_progress",
        parentId: PARENT,
        parentCode: "WP-05",
        parentName: "งานพื้น",
      },
    ],
  };

  it("a completed unassigned leaf is not offered", async () => {
    const user = userEvent.setup();
    renderCockpit(STATUS_BOARD);
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    expect(within(team).queryByLabelText(/งานเอ/)).toBeNull();
  });

  it("a completed ASSIGNED leaf stays offered, tagged เสร็จแล้ว (#742 invariant)", async () => {
    const user = userEvent.setup();
    renderCockpit({
      ...STATUS_BOARD,
      teams: [{ ...STATUS_BOARD.teams[0]!, wpIds: [WPA] }],
    });
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    expect(within(team).getByLabelText(/งานเอ/)).toBeChecked();
    expect(within(team).getByText("เสร็จแล้ว")).toBeInTheDocument();
    // …and saving keeps it (prune must not drop a filtered-but-assigned leaf).
    await user.click(within(team).getByRole("button", { name: "บันทึกงาน" }));
    expect(setMusterTeamWps).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, wpIds: [WPA] }),
    );
  });

  it("an unassigned team's picker seeds from the prior day, hint shown, save persists", async () => {
    const user = userEvent.setup();
    renderCockpit({
      ...STATUS_BOARD,
      teams: [{ ...STATUS_BOARD.teams[0]!, wpIds: [], prefillWpIds: [WPB] }],
    });
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    // The seeded leaf sits in a group — it must be auto-expanded and checked.
    expect(within(team).getByLabelText(/ปูพื้น/)).toBeChecked();
    expect(within(team).getByText(/มัสเตอร์วันก่อน/)).toBeInTheDocument();
    await user.click(within(team).getByRole("button", { name: "บันทึกงาน" }));
    expect(setMusterTeamWps).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, wpIds: [WPB] }),
    );
  });

  it("a team WITH assignments seeds from them — prefill and hint do not apply", async () => {
    const user = userEvent.setup();
    renderCockpit({
      ...STATUS_BOARD,
      teams: [{ ...STATUS_BOARD.teams[0]!, wpIds: [WPB], prefillWpIds: [WPB] }],
    });
    const team = screen.getByTestId(`team-${T1}`);
    await user.click(within(team).getByRole("button", { name: /แก้ไขงาน/ }));
    expect(within(team).getByLabelText(/ปูพื้น/)).toBeChecked();
    expect(within(team).queryByText(/มัสเตอร์วันก่อน/)).toBeNull();
  });
});

describe("MusterCockpit — no intra-day move (spec 357 U-E)", () => {
  // Operator 2026-07-24: no team change within a day (the "at OT" case is a
  // separate future feature). The strongest former trigger — 2+ teams, เข้า
  // mode — must now render no move affordance at all.
  it("member rows offer no ย้าย even with 2+ teams in เข้า mode", () => {
    const T2 = "ffffffff-6666-6666-6666-666666666666";
    renderCockpit({
      ...BOARD,
      teams: [
        BOARD.teams[0]!,
        {
          id: T2,
          leadWorkerId: W2,
          leadName: "สมชาย",
          members: [
            {
              workerId: W2,
              name: "สมชาย",
              gender: null,
              inAt: "2026-07-13T01:05:00Z",
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
    });
    expect(screen.queryByRole("button", { name: "ย้าย" })).toBeNull();
    expect(screen.queryByText(/ย้ายไปทีมของ/)).toBeNull();
  });
});

describe("MusterCockpit — scanner capability gates the sheet camera (spec 306 U3b / 357 U-D)", () => {
  // jsdom has neither BarcodeDetector nor mediaDevices — the baseline device
  // that genuinely cannot scan. The add sheet must still open (tap-add is the
  // lost-badge/phoneless path) but mount no camera.
  it("no camera capability at all → the sheet opens tap-add only, no camera", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("camera-mock")).toBeNull();
  });

  it("getUserMedia without BarcodeDetector (iPhone) → the sheet mounts the camera", async () => {
    // The day-1 gap: the pilot SA's iPhone has a camera but no BarcodeDetector.
    // The gate keys on overall scanner support (native OR jsQR fallback).
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    try {
      const user = userEvent.setup();
      renderCockpit();
      await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
      expect(screen.getByTestId("camera-mock")).toBeInTheDocument();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });
});

describe("MusterCockpit — header QR door + add sheet (spec 357 U-D)", () => {
  it("the header door renders in เข้า+regular even without any camera", () => {
    renderCockpit();
    expect(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" })).toBeInTheDocument();
  });

  it("ออก mode without camera → no door (row buttons carry the manual path)", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("button", { name: "ออก" }));
    expect(screen.queryByRole("button", { name: "สแกน QR / เพิ่มช่าง" })).toBeNull();
  });

  it("ออก mode WITH camera → the door renders (scan-to-check-out)", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    try {
      const user = userEvent.setup();
      renderCockpit();
      await user.click(screen.getByRole("button", { name: "ออก" }));
      expect(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" })).toBeInTheDocument();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });

  it("the sheet stays open across taps and the remaining addable stay listed", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "สมชาย" }));
    // Still open after a tap (the lineup adds several members in a row)…
    const sheet = screen.getByRole("dialog");
    // …and the other addable worker is still there to tap next.
    expect(within(sheet).getByRole("button", { name: "ก้อง" })).toBeInTheDocument();
  });

  // Spec 359 U3 moved the TAP failure into the tally (attributed to the person —
  // see that describe). The sheet-level alert stays for the remaining producer:
  // a board action that resolves while the sheet is already open.
  it("a page-level action error still renders inside the open sheet", () => {
    render(
      <MusterAddSheet
        leadName="ลี"
        actionLabel="กำลังเช็คเข้า"
        sessionLabel="งานปกติ"
        hasCamera={false}
        showTapAdd
        addable={[]}
        message="ไม่มีสิทธิ์เช็คชื่อ"
        pending={false}
        sweep={[]}
        onScanDetected={() => {}}
        onTapAdd={() => {}}
        onMoveHere={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์เช็คชื่อ");
  });

  it("all workers mustered → the sheet says ช่างทุกคนเข้าทีมแล้ว", async () => {
    const ALL_IN: MusterBoard = {
      ...BOARD,
      teams: [
        {
          ...BOARD.teams[0]!,
          members: BOARD.workers.map((w) => ({
            workerId: w.id,
            name: w.name,
            gender: w.gender,
            inAt: "2026-07-13T01:00:00Z",
            outAt: null,
            ot: null,
            outAuto: false,
          })),
        },
      ],
    };
    const user = userEvent.setup();
    renderCockpit(ALL_IN);
    await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    expect(
      within(screen.getByRole("dialog")).getByText("ช่างทุกคนเข้าทีมแล้ว"),
    ).toBeInTheDocument();
  });

  it("+ เพิ่มช่าง and the body สแกน QR buttons are gone", () => {
    renderCockpit();
    expect(screen.queryByRole("button", { name: "+ เพิ่มช่าง" })).toBeNull();
    expect(screen.queryByRole("button", { name: "สแกน QR" })).toBeNull();
  });

  // Spec 359 U1 moved the เข้า + regular path onto the continuous sweep (the
  // sheet stays open — see the sweep describe). One-shot survives unchanged in
  // the modes the sweep deliberately does NOT cover, so these two keep their
  // original intent and now exercise ออก.
  it("a camera detection fires a qr scan and closes the sheet (one-shot, ออก)", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    try {
      const user = userEvent.setup();
      renderCockpit();
      await user.click(screen.getByRole("button", { name: "ออก" }));
      await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
      await user.click(within(screen.getByRole("dialog")).getByTestId("camera-mock"));
      expect(musterScan).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: T1, workerId: W3, mode: "out", method: "qr" }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });

  it("a scan error after the one-shot close surfaces in the page-top alert (ออก)", async () => {
    musterScan.mockResolvedValueOnce({ ok: false, error: "ยังไม่ได้เช็คชื่อเข้าของช่างคนนี้" });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    try {
      const user = userEvent.setup();
      renderCockpit();
      await user.click(screen.getByRole("button", { name: "ออก" }));
      await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
      await user.click(within(screen.getByRole("dialog")).getByTestId("camera-mock"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(await screen.findByRole("alert")).toHaveTextContent("ยังไม่ได้เช็คชื่อเข้า");
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });

  it("opening the sheet clears a stale error from an earlier unrelated action", async () => {
    // Leave a failed open-team message on the page, then open the sheet — the
    // sheet must start clean, not greet the SA with the foreign error.
    openMusterTeam.mockResolvedValueOnce({ ok: false, error: "ไม่มีสิทธิ์ในโครงการนี้" });
    const user = userEvent.setup();
    renderCockpit();
    await user.selectOptions(screen.getByLabelText("เลือกหัวหน้าทีม"), W3);
    await user.click(screen.getByRole("button", { name: "เปิดทีม" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์");
    await user.click(screen.getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
    // …and the page-top copy is suppressed while the sheet is open.
    expect(screen.queryByRole("alert")).toBeNull();
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
            gender: null,
            inAt: "2026-07-13T01:00:00Z",
            outAt: "2026-07-13T10:00:00Z",
            ot: null,
            outAuto: false,
          },
        ],
        wpIds: [],
        prefillWpIds: [],
        missing: [],
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
      teams: [
        {
          id: T1,
          leadWorkerId: W1,
          leadName: "ลี",
          members: [],
          wpIds: [],
          prefillWpIds: [],
          missing: [],
        },
      ],
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
              gender: null,
              inAt: "2026-07-13T01:00:00Z",
              outAt: "2026-07-13T10:00:00Z",
              ot: { inAt: "2026-07-13T10:30:00Z", outAt: null, otHours: null },
              outAuto: false,
            },
          ],
          wpIds: [],
          prefillWpIds: [],
          missing: [],
        },
      ],
    };
    renderCockpit(OT_OPEN);
    await user.click(screen.getByRole("button", { name: "ปิดวัน" }));
    expect(screen.getByText(/ยัง OT ไม่ปิด/)).toBeInTheDocument();
  });
});

// Spec 357 U-C — the ยังไม่มา section: expected crew members not yet on site,
// with a one-tap เช็คอิน that is ALWAYS a regular check-IN (never the toggle).
describe("MusterCockpit — ยังไม่มา missing list (spec 357 U-C)", () => {
  const MISSING_BOARD: MusterBoard = {
    ...BOARD,
    teams: [
      {
        ...BOARD.teams[0]!,
        missing: [
          { id: W2, name: "สมชาย", gender: null },
          { id: W3, name: "ก้อง", gender: null },
        ],
      },
    ],
  };

  it("renders the section with a count and the missing names", () => {
    renderCockpit(MISSING_BOARD);
    const team = screen.getByTestId(`team-${T1}`);
    expect(within(team).getByText("ยังไม่มา (2)")).toBeInTheDocument();
    expect(within(team).getByText("สมชาย")).toBeInTheDocument();
    expect(within(team).getByText("ก้อง")).toBeInTheDocument();
  });

  it("เช็คอิน fires a manual regular check-IN even while the toggle is on ออก", async () => {
    const user = userEvent.setup();
    renderCockpit(MISSING_BOARD);
    await user.click(screen.getByRole("button", { name: "ออก" }));
    const team = screen.getByTestId(`team-${T1}`);
    const row = within(team).getByText("สมชาย").closest("li")!;
    await user.click(within(row as HTMLElement).getByRole("button", { name: "เช็คอิน" }));
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: T1,
        workerId: W2,
        mode: "in",
        method: "manual",
        session: "regular",
      }),
    );
  });

  it("no missing → no section", () => {
    renderCockpit();
    expect(screen.queryByText(/ยังไม่มา/)).toBeNull();
  });
});

// Spec 357 U-F — the ช/ญ gender chip on cockpit people rows (member rows, the
// ยังไม่มา rows, the add-sheet list), resolved off the workers roster; null
// gender renders nothing.
describe("MusterCockpit — gender chips (spec 357 U-F)", () => {
  const GENDER_BOARD: MusterBoard = {
    ...BOARD,
    teams: [
      {
        ...BOARD.teams[0]!,
        // The fold resolves member/missing gender off the roster in prod;
        // fixtures carry it directly (ลี male member, สมชาย female missing).
        members: [{ ...BOARD.teams[0]!.members[0]!, gender: "male" }],
        missing: [{ id: W2, name: "สมชาย", gender: "female" }],
      },
    ],
    workers: [
      { id: W1, name: "ลี", gender: "male" },
      { id: W2, name: "สมชาย", gender: "female" },
      { id: W3, name: "ก้อง", gender: null },
    ],
  };

  it("member and missing rows carry the chip; null gender renders none", async () => {
    const user = userEvent.setup();
    renderCockpit(GENDER_BOARD);
    const team = screen.getByTestId(`team-${T1}`);
    // ลี (member, male) → ช chip; สมชาย (missing, female) → ญ chip.
    expect(within(team).getAllByText("ช").length).toBeGreaterThanOrEqual(1);
    expect(within(team).getAllByText("ญ").length).toBeGreaterThanOrEqual(1);
    // The add sheet list shows ก้อง (null) without a chip and สมชาย… — สมชาย is
    // missing but addable too? No: missing means NOT mustered → addable. Open
    // the sheet and check ก้อง's button has no chip text.
    await user.click(within(team).getByRole("button", { name: "สแกน QR / เพิ่มช่าง" }));
    const sheet = screen.getByRole("dialog");
    const kong = within(sheet).getByRole("button", { name: /ก้อง/ });
    expect(kong.textContent).toBe("ก้อง");
  });
});

// Spec 359 U1 — the add sheet's action header + running tally. The header states
// the VERB (not a toggle state) because scanFromCamera dispatches on the
// เข้า/ออก + regular/OT toggles, and under a continuous sweep a wrong mode would
// check a whole team out in seconds. The tally is the SA's per-scan feedback
// while the sheet stays open.
describe("MusterAddSheet — action header + tally (spec 359 U1)", () => {
  const base = {
    leadName: "อนันต์ แสงทอง",
    actionLabel: "กำลังเช็คเข้า",
    sessionLabel: "งานปกติ",
    hasCamera: true,
    showTapAdd: true,
    addable: [],
    message: null,
    pending: false,
    sweep: [],
    onScanDetected: () => {},
    onTapAdd: () => {},
    onClose: () => {},
    onMoveHere: () => {},
  };

  it("names the action, the team and the session in one header line", () => {
    render(<MusterAddSheet {...base} />);
    const header = screen.getByTestId("sweep-action-header");
    expect(header.textContent).toContain("กำลังเช็คเข้า");
    expect(header.textContent).toContain("อนันต์ แสงทอง");
    expect(header.textContent).toContain("งานปกติ");
  });

  it("states the check-OUT verb when that is the active mode", () => {
    render(<MusterAddSheet {...base} actionLabel="กำลังเช็คออก" />);
    const header = screen.getByTestId("sweep-action-header");
    expect(header.textContent).toContain("กำลังเช็คออก");
    expect(header.textContent).not.toContain("กำลังเช็คเข้า");
  });

  it("counts only the added outcomes, not the refused ones", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 3, workerId: "w3", name: "ค", outcome: "other_team", detail: "จันทร์ เงางาม" },
          { seq: 2, workerId: "w2", name: "ข", outcome: "added_first_time", detail: null },
          { seq: 1, workerId: "w1", name: "ก", outcome: "added", detail: null },
        ]}
      />,
    );
    expect(screen.getByTestId("sweep-count").textContent).toContain("2");
  });

  it("renders entries newest first", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 2, workerId: "w2", name: "ข", outcome: "added", detail: null },
          { seq: 1, workerId: "w1", name: "ก", outcome: "added", detail: null },
        ]}
      />,
    );
    expect(screen.getAllByTestId("sweep-entry-name").map((n) => n.textContent)).toEqual(["ข", "ก"]);
  });

  it("shows the prior lead on a team change", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          {
            seq: 1,
            workerId: "w1",
            name: "ก",
            outcome: "added_team_changed",
            detail: "จันทร์ เงางาม",
          },
        ]}
      />,
    );
    expect(screen.getByText("เมื่อวานอยู่ทีม จันทร์ เงางาม")).toBeInTheDocument();
  });

  it("labels a never-before-mustered worker", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[{ seq: 1, workerId: "w1", name: "ก", outcome: "added_first_time", detail: null }]}
      />,
    );
    expect(screen.getByText("ครั้งแรก")).toBeInTheDocument();
  });

  it("names the other team when the worker is mustered elsewhere", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 1, workerId: "w1", name: "ก", outcome: "other_team", detail: "จันทร์ เงางาม" },
        ]}
      />,
    );
    expect(screen.getByText("อยู่ทีม จันทร์ เงางาม แล้ววันนี้")).toBeInTheDocument();
  });

  it("reports an unreadable badge without inventing a name", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[{ seq: 1, workerId: "junk", name: "junk", outcome: "unknown_badge", detail: null }]}
      />,
    );
    expect(screen.getByText("ไม่รู้จักบัตรนี้")).toBeInTheDocument();
    expect(screen.queryByText("junk")).not.toBeInTheDocument();
  });

  it("renders a refused write in danger tokens, not the advisory amber", () => {
    // Spec 359 U3 — a failed tap used to be a danger alert; sharing the amber
    // chip with a team-change note would demote a real failure to an advisory.
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 2, workerId: "w2", name: "ข", outcome: "failed", detail: "เช็คชื่อไม่สำเร็จ" },
          { seq: 1, workerId: "w1", name: "ก", outcome: "added_team_changed", detail: "ลี" },
        ]}
      />,
    );
    const failed = screen.getByText("เช็คชื่อไม่สำเร็จ");
    expect(failed.className).toContain("bg-danger-soft");
    expect(failed.className).not.toContain("bg-attn-soft");
    expect(screen.getByText("เมื่อวานอยู่ทีม ลี").className).toContain("bg-attn-soft");
  });

  it("surfaces the server message on a failed write", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 1, workerId: "w1", name: "ก", outcome: "failed", detail: "ไม่มีสิทธิ์เช็คชื่อ" },
        ]}
      />,
    );
    expect(screen.getByText("ไม่มีสิทธิ์เช็คชื่อ")).toBeInTheDocument();
  });

  it("renders no tally block at all before the first scan", () => {
    render(<MusterAddSheet {...base} sweep={[]} />);
    expect(screen.queryByTestId("sweep-count")).not.toBeInTheDocument();
  });
});

// Spec 359 U1 — the continuous sweep. The sheet stops closing on a decode so the
// SA can walk a team's line badge-to-badge; outcomes are classified from board
// state, and the board is refreshed ONCE on close rather than per scan.
describe("MusterCockpit — continuous sweep (spec 359 U1)", () => {
  const renderSweep = (board: MusterBoard = BOARD) =>
    render(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-26"
        revalidate="/projects/x/muster"
        board={board}
        htWorkerIds={[W1]}
        pastDayEnd={false}
      />,
    );

  // jsdom has no camera; the sheet only mounts one when scanner support is
  // detectable (getUserMedia is enough — the jsQR fallback path, spec 306 U3b).
  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    // The file's shared beforeEach re-sets musterScan's RESOLVED VALUE but never
    // its call log, and these tests assert exact call COUNTS — without this they
    // inherit every scan the earlier describes made.
    musterScan.mockClear();
  });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  });

  const openSheet = () => userEvent.click(screen.getAllByLabelText("สแกน QR / เพิ่มช่าง")[0]!);
  const scan = async (id: string) => {
    nextScanId.current = id;
    await act(async () => {
      await userEvent.click(screen.getByTestId("camera-mock-next"));
    });
  };

  it("keeps the sheet open after a successful decode", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    expect(screen.getByTestId("sweep-action-header")).toBeInTheDocument();
    expect(screen.getByTestId("sweep-count")).toBeInTheDocument();
  });

  it("scans as qr, check-in, regular session", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({ method: "qr", mode: "in", session: "regular", workerId: W2 }),
    );
  });

  it("writes once per badge and ignores a repeat inside the cooldown", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await scan(W2);
    expect(musterScan).toHaveBeenCalledTimes(1);
  });

  it("suppresses a same-tick repeat of one badge (the cooldown, not the board)", async () => {
    // The real hazard the cooldown exists for: the decode loop fires every
    // ~180ms while the badge is still in frame, with NO React commit between
    // firings — so both handlers see the same `sweep` closure and the
    // addedThisSweep guard cannot help. fireEvent (synchronous, unlike
    // userEvent) reproduces that; an awaited userEvent click would flush a
    // commit in between and let the board guard mask this.
    renderSweep();
    await openSheet();
    nextScanId.current = W2;
    const btn = screen.getByTestId("camera-mock-next");
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(musterScan).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the sweep added nobody", async () => {
    renderSweep();
    await openSheet();
    await scan(W1); // already on this team → no write, nothing added
    await userEvent.click(screen.getByText("ปิด"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("accumulates several different badges in one sweep", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await scan(W3);
    expect(musterScan).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("sweep-count").textContent).toContain("2");
  });

  it("does not call the server for a worker already on this team", async () => {
    renderSweep();
    await openSheet();
    await scan(W1); // W1 is already a member of T1 in BOARD
    expect(musterScan).not.toHaveBeenCalled();
    expect(screen.getByText("อยู่ในทีมแล้ว")).toBeInTheDocument();
  });

  it("refreshes the board once, on close — not per scan", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await scan(W3);
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("ปิด"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("marks the entry failed when the server refuses", async () => {
    musterScan.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์เช็คชื่อ" });
    renderSweep();
    await openSheet();
    await scan(W2);
    expect(await screen.findByText("ไม่มีสิทธิ์เช็คชื่อ")).toBeInTheDocument();
    expect(screen.getByTestId("sweep-count").textContent).toContain("0");
  });

  it("starts each sheet opening with an empty tally", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await userEvent.click(screen.getByText("ปิด"));
    await openSheet();
    expect(screen.queryByTestId("sweep-count")).not.toBeInTheDocument();
  });

  it("warns when the worker's last muster was a different lead", async () => {
    renderSweep({
      ...BOARD,
      priorTeamByWorker: [{ workerId: W2, leadWorkerId: W3, leadName: "ก้อง" }],
    });
    await openSheet();
    await scan(W2);
    expect(screen.getByText("เมื่อวานอยู่ทีม ก้อง")).toBeInTheDocument();
  });

  it("does not warn when the worker's last muster was this same lead", async () => {
    renderSweep({
      ...BOARD,
      priorTeamByWorker: [{ workerId: W2, leadWorkerId: W1, leadName: "ลี" }],
    });
    await openSheet();
    await scan(W2);
    expect(screen.queryByText(/เมื่อวานอยู่ทีม/)).not.toBeInTheDocument();
  });

  it("does not sweep in ออก mode — that keeps the one-shot behaviour", async () => {
    renderSweep();
    await userEvent.click(screen.getByText("ออก"));
    await openSheet();
    await scan(W2);
    expect(screen.queryByTestId("sweep-action-header")).not.toBeInTheDocument();
  });
});

// Spec 359 U1 — resolving an other-team row. The spec requires the move be
// offered AFTER the sweep, never as a modal mid-line: it lives in the tally row
// so the SA keeps scanning and deals with the amber rows when the line is done.
describe("MusterCockpit — ย้ายมาทีมนี้ (spec 359 U1)", () => {
  const T2 = "ffffffff-6666-6666-6666-666666666666";
  const boardWithW2Elsewhere: MusterBoard = {
    ...BOARD,
    teams: [
      ...BOARD.teams,
      {
        id: T2,
        leadWorkerId: W3,
        leadName: "ก้อง",
        members: [
          {
            workerId: W2,
            name: "สมชาย",
            gender: null,
            inAt: "2026-07-26T01:00:00Z",
            outAt: null,
            outAuto: false,
            ot: null,
          },
        ],
        wpIds: [],
        prefillWpIds: [],
        missing: [],
      },
    ],
  };

  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    musterScan.mockClear();
  });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  });

  const renderIt = (board: MusterBoard) =>
    render(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-26"
        revalidate="/projects/x/muster"
        board={board}
        htWorkerIds={[W1, W3]}
        pastDayEnd={false}
      />,
    );

  const scanInto = async (teamIdx: number, id: string) => {
    await userEvent.click(screen.getAllByLabelText("สแกน QR / เพิ่มช่าง")[teamIdx]!);
    nextScanId.current = id;
    await act(async () => {
      await userEvent.click(screen.getByTestId("camera-mock-next"));
    });
  };

  it("offers ย้ายมาทีมนี้ on an other-team row and moves on tap", async () => {
    renderIt(boardWithW2Elsewhere);
    await scanInto(0, W2);
    expect(musterScan).not.toHaveBeenCalled();
    await act(async () => {
      await userEvent.click(screen.getByText("ย้ายมาทีมนี้"));
    });
    expect(moveMusterWorker).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: W2, toTeamId: T1, date: "2026-07-26" }),
    );
    expect(screen.getByTestId("sweep-count").textContent).toContain("1");
  });

  it("offers no move button on an added row", async () => {
    renderIt(BOARD);
    await scanInto(0, W2);
    expect(screen.queryByText("ย้ายมาทีมนี้")).not.toBeInTheDocument();
  });

  it("surfaces a refused move on the row instead of silently doing nothing", async () => {
    moveMusterWorker.mockResolvedValue({ ok: false, error: "ย้ายข้ามโครงการไม่ได้" });
    renderIt(boardWithW2Elsewhere);
    await scanInto(0, W2);
    await act(async () => {
      await userEvent.click(screen.getByText("ย้ายมาทีมนี้"));
    });
    expect(await screen.findByText("ย้ายข้ามโครงการไม่ได้")).toBeInTheDocument();
  });
});

// Spec 359 U2 — camera-first. The sheet opens into the viewfinder and the tap
// list moves behind a disclosure. The tap list is the lost-badge / phoneless
// safety net (spec 357 U-D's signal-removal rule) so it stays one tap away and
// keeps its stays-open behaviour; a device with no camera is untouched.
describe("MusterAddSheet — camera-first (spec 359 U2)", () => {
  const base = {
    leadName: "อนันต์ แสงทอง",
    actionLabel: "กำลังเช็คเข้า",
    sessionLabel: "งานปกติ",
    showTapAdd: true,
    addable: [
      {
        id: "w1",
        name: "สมชาย",
        gender: null,
        otherTeamLead: null,
        otherTeamDone: false,
        added: false,
      },
    ],
    message: null,
    pending: false,
    sweep: [],
    onScanDetected: () => {},
    onTapAdd: () => {},
    onMoveHere: () => {},
    onClose: () => {},
  };

  it("collapses the tap list behind a disclosure when a camera is available", () => {
    render(<MusterAddSheet {...base} hasCamera />);
    expect(screen.getByText("ไม่มีบัตร / หาไม่เจอ")).toBeInTheDocument();
    // <details> keeps the content in the DOM but hidden — assert it is not
    // exposed, which is what "the SA sees the camera first" actually means.
    expect(screen.getByRole("button", { name: "สมชาย" })).not.toBeVisible();
  });

  it("reveals the tap list when the disclosure is opened", async () => {
    render(<MusterAddSheet {...base} hasCamera />);
    await userEvent.click(screen.getByText("ไม่มีบัตร / หาไม่เจอ"));
    expect(screen.getByRole("button", { name: "สมชาย" })).toBeVisible();
  });

  it("leaves the tap list open and undisclosed when there is no camera", () => {
    render(<MusterAddSheet {...base} hasCamera={false} />);
    expect(screen.getByRole("button", { name: "สมชาย" })).toBeVisible();
    expect(screen.queryByText("ไม่มีบัตร / หาไม่เจอ")).not.toBeInTheDocument();
  });

  it("still renders no tap list at all outside เข้า + regular", () => {
    render(<MusterAddSheet {...base} hasCamera showTapAdd={false} />);
    expect(screen.queryByText("ไม่มีบัตร / หาไม่เจอ")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "สมชาย" })).not.toBeInTheDocument();
  });
});

// Spec 359 U3 — the sweep's outcomes were wired to the CAMERA path only, but no
// badge has been printed yet, so every real check-in is a manual tap: the
// team-change warn, the tally and the other-team resolution were dead on real
// traffic. A tap now runs through the same `classifyScan` pipeline as a decode
// (method "manual"), and a worker already mustered on ANOTHER team is offered in
// the list — with the ย้าย UI removed in #748, a QR decode was otherwise the only
// door to `move_muster_worker`, unreachable for a phoneless worker.
describe("MusterCockpit — manual tap-add runs the sweep pipeline (spec 359 U3)", () => {
  const T2 = "ffffffff-6666-6666-6666-666666666666";
  const W4 = "99999999-7777-7777-7777-777777777777";
  const TWO_TEAM: MusterBoard = {
    ...BOARD,
    teams: [
      BOARD.teams[0]!,
      {
        id: T2,
        leadWorkerId: W3,
        leadName: "ก้อง",
        members: [
          {
            workerId: W2,
            name: "สมชาย",
            gender: null,
            inAt: "2026-07-13T01:05:00Z",
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
    workers: [...BOARD.workers, { id: W4, name: "มานะ", gender: null }],
  };

  beforeEach(() => {
    musterScan.mockClear();
  });

  const openSheet = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(
      within(screen.getByTestId(`team-${T1}`)).getByRole("button", {
        name: "สแกน QR / เพิ่มช่าง",
      }),
    );
  const tapList = () => within(screen.getByTestId("tap-add-list"));
  const tap = (user: ReturnType<typeof userEvent.setup>, name: RegExp) =>
    user.click(tapList().getByRole("button", { name }));

  it("a tap lands in the tally, not just in a silent write", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: T1, workerId: W4, mode: "in", method: "manual" }),
    );
    expect(screen.getByTestId("sweep-count").textContent).toContain("1");
    expect(screen.getByText("ครั้งแรก")).toBeInTheDocument();
  });

  it("warns on a tap when the worker's last muster was a different lead", async () => {
    const user = userEvent.setup();
    renderCockpit({
      ...TWO_TEAM,
      priorTeamByWorker: [{ workerId: W4, leadWorkerId: W3, leadName: "ก้อง" }],
    });
    await openSheet(user);
    await tap(user, /มานะ/);
    expect(screen.getByText("เมื่อวานอยู่ทีม ก้อง")).toBeInTheDocument();
  });

  it("stays silent on a tap when the prior lead is this same team's lead", async () => {
    const user = userEvent.setup();
    renderCockpit({
      ...TWO_TEAM,
      priorTeamByWorker: [{ workerId: W4, leadWorkerId: W1, leadName: "ลี" }],
    });
    await openSheet(user);
    await tap(user, /มานะ/);
    // Positive first: the tally DID record them (a pure negative would also
    // pass on no entry at all, or on a detail-less team-change note).
    const tally = within(screen.getByTestId("sweep-tally"));
    expect(tally.getByTestId("sweep-entry-name").textContent).toContain("มานะ");
    expect(screen.queryByText(/เมื่อวานอยู่ทีม/)).not.toBeInTheDocument();
    expect(screen.queryByText("เปลี่ยนทีมจากครั้งก่อน")).not.toBeInTheDocument();
  });

  it("lists a worker already mustered elsewhere, naming the team they are on", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    expect(tapList().getByRole("button", { name: /สมชาย/ }).textContent).toContain("อยู่ทีม ก้อง");
  });

  it("orders the free workers ahead of the ones already on another team", async () => {
    const user = userEvent.setup();
    // W2 (สมชาย, on team 2) comes BEFORE W4 (มานะ, free) in board.workers, so a
    // pass-through order would put the straggler first.
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    const names = tapList()
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names[0]).toContain("มานะ");
    expect(names[1]).toContain("สมชาย");
  });

  it("tapping that worker refuses the write and offers ย้ายมาทีมนี้", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /สมชาย/);
    expect(musterScan).not.toHaveBeenCalled();
    expect(screen.getByText("อยู่ทีม ก้อง แล้ววันนี้")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ย้ายมาทีมนี้" }));
    expect(moveMusterWorker).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: W2, toTeamId: T1, date: "2026-07-13" }),
    );
    // Resolved → the offer is withdrawn, so a second row for the same worker
    // can never re-fire the move.
    expect(screen.queryByRole("button", { name: "ย้ายมาทีมนี้" })).toBeNull();
  });

  it("two taps on one other-team row leave a single live move offer", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /สมชาย/);
    await tap(user, /สมชาย/);
    expect(screen.getAllByRole("button", { name: "ย้ายมาทีมนี้" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "ย้ายมาทีมนี้" })[0]!);
    expect(moveMusterWorker).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "ย้ายมาทีมนี้" })).toBeNull();
  });

  it("says a tagged worker already finished on the other team", async () => {
    const user = userEvent.setup();
    renderCockpit({
      ...TWO_TEAM,
      teams: [
        TWO_TEAM.teams[0]!,
        {
          ...TWO_TEAM.teams[1]!,
          members: [{ ...TWO_TEAM.teams[1]!.members[0]!, outAt: "2026-07-13T10:00:00Z" }],
        },
      ],
    });
    await openSheet(user);
    // move_muster_worker moves EVERY session of the day, so a completed one
    // would be re-pointed silently without this.
    expect(tapList().getByRole("button", { name: /สมชาย/ }).textContent).toContain("ออกแล้ว");
  });

  it("tells the SA what a tagged row's tap actually does", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    expect(
      within(screen.getByTestId("tap-add-list")).getByText(/แตะเพื่อขอย้ายมาทีมนี้/),
    ).toBeInTheDocument();
  });

  it("no tagged rows → no move hint", async () => {
    const user = userEvent.setup();
    renderCockpit({ ...TWO_TEAM, teams: [TWO_TEAM.teams[0]!] });
    await openSheet(user);
    expect(screen.queryByText(/แตะเพื่อขอย้ายมาทีมนี้/)).toBeNull();
  });

  it("a badge re-read after a move answers อยู่ในทีมแล้ว, not a second move offer", async () => {
    // The board still says "other team" until the sheet closes, so without the
    // moved id in the addedThisSweep ref the tally would offer ย้ายมาทีมนี้ again.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    try {
      const user = userEvent.setup();
      renderCockpit(TWO_TEAM);
      await openSheet(user);
      await user.click(within(screen.getByRole("dialog")).getByText("ไม่มีบัตร / หาไม่เจอ"));
      await tap(user, /สมชาย/);
      await user.click(screen.getByRole("button", { name: "ย้ายมาทีมนี้" }));
      nextScanId.current = W2;
      await act(async () => {
        await user.click(screen.getByTestId("camera-mock-next"));
      });
      expect(screen.getByText("อยู่ในทีมแล้ว")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "ย้ายมาทีมนี้" })).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });

  it("never offers another team's lead, nor a member of this team", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    // Exact names: the สมชาย row's accessible name now CONTAINS "ก้อง" (its
    // อยู่ทีม chip), so a substring match would pass for the wrong reason.
    expect(tapList().queryByRole("button", { name: "ก้อง" })).toBeNull();
    expect(tapList().queryByRole("button", { name: "ลี" })).toBeNull();
  });

  it("an added worker stays listed but inert — the rows below must not shift", async () => {
    // Removing the row reflows every chip after it under a finger already on
    // its way down, and a mis-tap here writes attendance for the wrong person.
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    const row = tapList().getByRole("button", { name: /มานะ/ });
    expect(row).toBeDisabled();
    expect(row.textContent).toContain("✓");
    expect(tapList().getByRole("button", { name: /สมชาย/ })).toBeInTheDocument();
  });

  it("the added row survives the board catching up mid-sweep", async () => {
    // The real sequence the previous test cannot reach: musterScan's
    // revalidatePath re-renders the page WHILE the sheet is open, so the worker
    // arrives as a member of THIS team. Without the added-id exemption the row
    // would vanish at that moment and reflow the rest of the lineup.
    const user = userEvent.setup();
    const { rerender } = render(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-13"
        revalidate="/projects/x/muster"
        board={TWO_TEAM}
        pastDayEnd={false}
        htWorkerIds={TWO_TEAM.workers.map((w) => w.id)}
      />,
    );
    await openSheet(user);
    await tap(user, /มานะ/);
    const CAUGHT_UP: MusterBoard = {
      ...TWO_TEAM,
      teams: [
        {
          ...TWO_TEAM.teams[0]!,
          members: [
            ...TWO_TEAM.teams[0]!.members,
            {
              workerId: W4,
              name: "มานะ",
              gender: null,
              inAt: "2026-07-13T01:10:00Z",
              outAt: null,
              ot: null,
              outAuto: false,
            },
          ],
        },
        TWO_TEAM.teams[1]!,
      ],
    };
    rerender(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-13"
        revalidate="/projects/x/muster"
        board={CAUGHT_UP}
        pastDayEnd={false}
        htWorkerIds={TWO_TEAM.workers.map((w) => w.id)}
      />,
    );
    const row = tapList().getByRole("button", { name: /มานะ/ });
    expect(row).toBeDisabled();
    expect(row.textContent).toContain("✓");
  });

  it("a second tap on an added row writes nothing", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    await user.click(tapList().getByRole("button", { name: /มานะ/ }));
    expect(musterScan).toHaveBeenCalledTimes(1);
  });

  it("two taps of one name inside a single tick write once", async () => {
    // The tap list has no cooldown (a deliberate re-tap must give feedback, not
    // silence), so the write guard is the synchronous addedThisSweep ref. Two
    // fireEvents inside one act() share a render closure — the shape that let
    // #763's cooldown bug through.
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    const btn = tapList().getByRole("button", { name: /มานะ/ });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(musterScan).toHaveBeenCalledTimes(1);
    // Both clicks LANDED — two tally rows, the second refused as already-here.
    // Without this the test would also pass if the second click never fired.
    expect(
      within(screen.getByTestId("sweep-tally")).getAllByTestId("sweep-entry-name"),
    ).toHaveLength(2);
    expect(screen.getByText("อยู่ในทีมแล้ว")).toBeInTheDocument();
  });

  it("a refusal that lands after the sheet closed surfaces on the page, not nowhere", async () => {
    // The sweep that issued the write is gone: its tally is unmounted and
    // addedRef has been replaced, so markFailed would no-op and the SA would
    // never learn the worker is not checked in.
    let settle: (r: { ok: boolean; error: string }) => void = () => {};
    musterScan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    await user.click(screen.getByRole("button", { name: "ปิด" }));
    await act(async () => {
      settle({ ok: false, error: "ไม่มีสิทธิ์เช็คชื่อ" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์เช็คชื่อ");
  });

  it("attributes a refused write to the person in the tally", async () => {
    musterScan.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์เช็คชื่อ" });
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    expect(await screen.findByText("ไม่มีสิทธิ์เช็คชื่อ")).toBeInTheDocument();
    expect(screen.getByTestId("sweep-count").textContent).toContain("0");
    musterScan.mockResolvedValue({ ok: true, id: "att" });
  });

  it("a refused worker can be retried — they return to the list and write again", async () => {
    musterScan.mockResolvedValueOnce({ ok: false, error: "เช็คชื่อไม่สำเร็จ" });
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    expect(await screen.findByText("เช็คชื่อไม่สำเร็จ")).toBeInTheDocument();
    // The failure released them from addedThisSweep, so the row is back…
    await tap(user, /มานะ/);
    expect(musterScan).toHaveBeenCalledTimes(2);
  });

  it("refreshes the board once on close, not per tap", async () => {
    const user = userEvent.setup();
    renderCockpit(TWO_TEAM);
    await openSheet(user);
    await tap(user, /มานะ/);
    expect(refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ปิด" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
