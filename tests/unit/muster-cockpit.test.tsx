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
  wps: [{ id: WPA, code: "A", name: "งานเอ" }],
  closure: null,
};

function renderCockpit(board: MusterBoard = BOARD) {
  return render(
    <MusterCockpit
      projectId={PROJECT}
      date="2026-07-13"
      revalidate="/projects/x/muster"
      board={board}
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
