// Spec 334 U2 — the /team/roster merged board. The roster is the new home for the
// per-name status chips CrewProgressRoster used to own as separate sections:
//   • รอ PM ยืนยัน  — a PM has not cost/level-confirmed the worker (cost_confirmed_at IS NULL)
//   • รอ PM กรอกบัญชี — a phoneless SA-add awaiting a PM's bank transcription (spec 298 U2)
// plus the roster's own empty state. The page is an async server component (the
// browser drive verifies it end-to-end); the unit-testable pieces are the
// SiteTeamBoard component driven with built board data, exactly as the existing
// site-board tests do (tests/unit/site-team-board-view.test.tsx). RED-first.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SiteTeamBoard } from "@/components/features/sa/site-team-board";
import type { SiteTeamBoard as SiteTeamBoardData } from "@/lib/sa/site-team-board";
import { BANK_PENDING_CHIP_LABEL, UNASSIGNED_TEAM_LABEL } from "@/lib/i18n/labels";

// Single-surface, local to the site-team-board component (SSOT rule) — pinned here
// as its own literal so the assertion never re-derives it from the component.
const COST_PENDING_CHIP = "รอ PM ยืนยัน";
// The roster's empty state (spec U2 negative case "no workers at all").
const ROSTER_EMPTY = "ยังไม่มีช่างในระบบ — เพิ่มช่างจากหน้าทีมงาน";

describe("team roster — status chips on a member row", () => {
  it("renders both รอ PM ยืนยัน and รอ PM กรอกบัญชี when a member carries both flags", () => {
    const board: SiteTeamBoardData = {
      total: 1,
      internal: [
        {
          id: "C1",
          name: "ทีมเอ",
          leadName: null,
          members: [
            { id: "w1", name: "ช่างหนึ่ง", level: null, costPending: true, bankPending: true },
          ],
        },
      ],
      external: [],
      siteAccess: [],
      unassigned: [],
    };
    render(<SiteTeamBoard board={board} />);
    // Members sit behind the collapse — expand the crew card to reveal the row.
    fireEvent.click(screen.getByRole("button", { name: /ทีมเอ/ }));
    expect(screen.getByText(COST_PENDING_CHIP)).toBeInTheDocument();
    expect(screen.getByText(BANK_PENDING_CHIP_LABEL)).toBeInTheDocument();
  });
});

describe("team roster — buckets", () => {
  it("puts crewless workers under ยังไม่ได้จัดทีม with no team bucket rendered", () => {
    const board: SiteTeamBoardData = {
      total: 2,
      internal: [],
      external: [],
      siteAccess: [],
      unassigned: [
        { id: "w1", name: "ช่างลอยหนึ่ง", level: null },
        { id: "w2", name: "ช่างลอยสอง", level: null },
      ],
    };
    render(<SiteTeamBoard board={board} />);
    expect(screen.getByText(UNASSIGNED_TEAM_LABEL)).toBeInTheDocument();
    expect(screen.getByText("ช่างลอยหนึ่ง")).toBeInTheDocument();
    expect(screen.getByText("ช่างลอยสอง")).toBeInTheDocument();
    // No team (ทีมภายใน) bucket when every worker is crewless — bare-literal absence pin.
    expect(screen.queryByText("ทีมภายใน")).not.toBeInTheDocument();
  });
});

describe("team roster — empty state", () => {
  it("shows the roster empty string when the board has nobody on it", () => {
    const board: SiteTeamBoardData = {
      total: 0,
      internal: [],
      external: [],
      siteAccess: [],
      unassigned: [],
    };
    render(<SiteTeamBoard board={board} emptyLabel={ROSTER_EMPTY} />);
    expect(screen.getByText(ROSTER_EMPTY)).toBeInTheDocument();
  });

  // Orchestrator review fix 2 (spec U2 negative case "no workers at all"): a real
  // SA is ALWAYS in ฝ่ายไซต์ (project_site_management returns the viewer), so
  // total ≥ 1 and the old total===0 branch could never fire in production. The
  // empty notice must key on WORKERS, not total — and the ฝ่ายไซต์ bucket still
  // renders alongside it.
  it("shows the empty string even when ฝ่ายไซต์ has people, as long as no workers exist", () => {
    const board: SiteTeamBoardData = {
      total: 1,
      internal: [],
      external: [],
      siteAccess: [{ userId: "u1", name: "หัวหน้าไซต์" }],
      unassigned: [],
    };
    render(<SiteTeamBoard board={board} emptyLabel={ROSTER_EMPTY} />);
    expect(screen.getByText(ROSTER_EMPTY)).toBeInTheDocument();
    expect(screen.getByText("หัวหน้าไซต์")).toBeInTheDocument();
  });
});

describe("team roster — chips reach the unassigned bucket", () => {
  // Orchestrator review fix 1 (spec U2 "each name carrying the status chips"): on
  // prod 5 of 26 active workers are crewless and ALL are cost-pending — rendering
  // ยังไม่ได้จัดทีม via the names-only PeopleList would strip exactly their chips.
  it("renders รอ PM ยืนยัน on a crewless worker", () => {
    const board: SiteTeamBoardData = {
      total: 1,
      internal: [],
      external: [],
      siteAccess: [],
      unassigned: [{ id: "w9", name: "ช่างลอยรอยืนยัน", level: null, costPending: true }],
    };
    render(<SiteTeamBoard board={board} />);
    expect(screen.getByText("ช่างลอยรอยืนยัน")).toBeInTheDocument();
    expect(screen.getByText(COST_PENDING_CHIP)).toBeInTheDocument();
  });
});
