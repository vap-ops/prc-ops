// Spec 330 U6 — WP↔team assignment on the map: the crewless tray, tap-tap
// placing (crew cards ONLY as targets), per-chip ย้าย/เอาออก with the
// mixed-item lockout, the วันนี้/พรุ่งนี้ toggle, and เพิ่มงานเข้าแผน.
// Writes relay the EXISTING /sa/plan actions — asserted on the mocks.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockApply, mockSetCrew, mockAddItem, mockToastError } = vi.hoisted(() => ({
  mockApply: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  mockSetCrew: vi.fn(async () => ({ ok: true })),
  mockAddItem: vi.fn(async () => ({ ok: true })),
  mockToastError: vi.fn(),
}));

vi.mock("@/app/sa/plan/actions", () => ({
  applyPlanSuggestions: mockApply,
  setDailyPlanItemCrew: mockSetCrew,
  addDailyPlanItem: mockAddItem,
}));
vi.mock("@/lib/team-map/crew-actions", () => ({
  addWorkerToCrew: vi.fn(async () => ({ ok: true, id: "x" })),
  removeWorkerFromCrew: vi.fn(async () => ({ ok: true, id: "x" })),
  moveWorkerBetweenCrews: vi.fn(async () => ({ ok: true, id: "x" })),
  setCrewLead: vi.fn(async () => ({ ok: true, id: "x" })),
  createCrew: vi.fn(async () => ({ ok: true, id: "x" })),
  renameCrew: vi.fn(async () => ({ ok: true, id: "x" })),
  dissolveCrew: vi.fn(async () => ({ ok: true, id: "x" })),
}));
vi.mock("@/app/projects/[projectId]/settings/actions", () => ({
  addProjectMember: vi.fn(async () => ({ ok: true })),
  removeProjectMember: vi.fn(async () => ({ ok: true })),
  setPrimaryProjectFor: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: mockToastError,
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { TeamMapView } from "@/components/features/team-map/team-map-view";
import type { ProjectTeamMap } from "@/lib/team-map/build-team-map";
import type { DayPlanWpItem, TeamMapDayPlan } from "@/lib/work-plans/day-assignments";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-07-19";
const TOMORROW = "2026-07-20";

const MAP: ProjectTeamMap = {
  management: [],
  site: [],
  teams: [
    {
      kind: "crew",
      id: "cr-a",
      name: "ทีม ก",
      members: [
        { workerId: "a1", name: "หนึ่ง", isTeamLead: true, contractorId: null },
        { workerId: "a2", name: "สอง", isTeamLead: false, contractorId: null },
      ],
      count: 2,
    },
    {
      kind: "crew",
      id: "cr-b",
      name: "ทีม ข",
      members: [{ workerId: "b1", name: "สาม", isTeamLead: false, contractorId: null }],
      count: 1,
    },
    {
      // A pre-wall contractor-tied member sitting INSIDE a crew (possible only
      // for rows older than mig 075818). The §2.4 filter must drop them from
      // any plan write — daily_work_plan_crew feeds log_labor_day → payroll.
      kind: "crew",
      id: "cr-c",
      name: "ทีม ค",
      members: [
        { workerId: "c1", name: "สี่", isTeamLead: false, contractorId: null },
        { workerId: "cx", name: "ห้า", isTeamLead: false, contractorId: "firm-1" },
      ],
      count: 2,
    },
    {
      kind: "firm",
      id: "firm-1",
      name: "ทีมช่างอวย",
      members: [{ workerId: "f1", name: "อวย", isTeamLead: false, contractorId: "firm-1" }],
      count: 1,
    },
  ],
  crewTotal: 4,
  teamCount: 3,
  memberCount: 0,
};

const it_ = (id: string, workerIds: string[]): DayPlanWpItem => ({
  itemId: `it-${id}`,
  workPackageId: `wp-${id}`,
  code: `WP-${id}`,
  name: `งาน${id}`,
  workerIds,
});

const DAY_PLANS: { today: TeamMapDayPlan; tomorrow: TeamMapDayPlan } = {
  today: { date: TODAY, items: [it_("t1", []), it_("s1", ["a1", "a2"]), it_("m1", ["a1", "b1"])] },
  tomorrow: { date: TOMORROW, items: [it_("n1", [])] },
};

const PLAN_WPS = [
  { id: "wp-x", code: "WP-X", name: "งานใหม่เอ็กซ์" },
  { id: "wp-y", code: "WP-Y", name: "งานใหม่วาย" },
];

function renderView() {
  return render(
    <TeamMapView
      projectId={PROJECT}
      map={MAP}
      addableStaff={[]}
      currentUserId="u-x"
      dayPlans={DAY_PLANS}
      planWps={PLAN_WPS}
    />,
  );
}

beforeEach(() => {
  mockApply.mockClear();
  mockSetCrew.mockClear();
  mockAddItem.mockClear();
  mockToastError.mockClear();
});
afterEach(cleanup);

describe("team map — WP assignment (spec 330 U6)", () => {
  it("the tray lists today's crewless items by default", () => {
    renderView();
    const tray = screen.getByTestId("wp-tray");
    expect(within(tray).getByRole("button", { name: /WP-t1/ })).toBeInTheDocument();
    expect(within(tray).queryByRole("button", { name: /WP-s1/ })).not.toBeInTheDocument();
  });

  it("tap-tap: tray chip then a CREW card assigns the whole team via applyPlanSuggestions", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(within(screen.getByTestId("wp-tray")).getByRole("button", { name: /WP-t1/ }));
    // Placing mode: crew cards offer a target, the firm card does not.
    expect(
      within(screen.getByTestId("team-card-firm-1")).queryByRole("button", {
        name: /วางที่ทีมนี้/,
      }),
    ).not.toBeInTheDocument();
    await user.click(
      within(screen.getByTestId("team-card-cr-a")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    );
    expect(mockApply).toHaveBeenCalledWith(PROJECT, TODAY, [
      { wp: "wp-t1", crew: { workerIds: ["a1", "a2"], lead: "a1" } },
    ]);
  });

  it("a lead-less target team passes lead null", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(within(screen.getByTestId("wp-tray")).getByRole("button", { name: /WP-t1/ }));
    await user.click(
      within(screen.getByTestId("team-card-cr-b")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    );
    expect(mockApply).toHaveBeenCalledWith(PROJECT, TODAY, [
      { wp: "wp-t1", crew: { workerIds: ["b1"], lead: null } },
    ]);
  });

  it("tapping the picked chip again cancels placing mode", async () => {
    const user = userEvent.setup();
    renderView();
    const chip = within(screen.getByTestId("wp-tray")).getByRole("button", { name: /WP-t1/ });
    await user.click(chip);
    expect(
      within(screen.getByTestId("team-card-cr-a")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    ).toBeInTheDocument();
    await user.click(chip);
    expect(
      within(screen.getByTestId("team-card-cr-a")).queryByRole("button", {
        name: /วางที่ทีมนี้/,
      }),
    ).not.toBeInTheDocument();
  });

  it("an assigned chip offers ย้าย + เอาออก + a WP link; เอาออก clears the crew", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-a")).getByRole("button", { name: /WP-s1/ }),
    );
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /ย้ายไปทีมอื่น/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /เปิดหน้างาน/ })).toHaveAttribute(
      "href",
      `/projects/${PROJECT}/work-packages/wp-s1`,
    );
    await user.click(within(sheet).getByRole("button", { name: /เอาออกจากทีม/ }));
    expect(mockSetCrew).toHaveBeenCalledWith("it-s1", [], null);
  });

  it("ย้ายไปทีมอื่น re-places onto the target team", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-a")).getByRole("button", { name: /WP-s1/ }),
    );
    await user.click(screen.getByRole("button", { name: /ย้ายไปทีมอื่น/ }));
    await user.click(
      within(screen.getByTestId("team-card-cr-b")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    );
    expect(mockApply).toHaveBeenCalledWith(PROJECT, TODAY, [
      { wp: "wp-s1", crew: { workerIds: ["b1"], lead: null } },
    ]);
  });

  it("a MIXED chip locks out team-grain writes and links to the plan", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-a")).getByRole("button", { name: /WP-m1/ }),
    );
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: /เอาออกจากทีม/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /ย้ายไปทีมอื่น/ })).not.toBeInTheDocument();
    expect(within(sheet).getByText(/จัดคนรายบุคคล/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /แผนงาน/ })).toBeInTheDocument();
  });

  it("พรุ่งนี้ switches the tray and the write date", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /พรุ่งนี้/ }));
    const tray = screen.getByTestId("wp-tray");
    expect(within(tray).getByRole("button", { name: /WP-n1/ })).toBeInTheDocument();
    expect(within(tray).queryByRole("button", { name: /WP-t1/ })).not.toBeInTheDocument();
    await user.click(within(tray).getByRole("button", { name: /WP-n1/ }));
    await user.click(
      within(screen.getByTestId("team-card-cr-b")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    );
    expect(mockApply).toHaveBeenCalledWith(PROJECT, TOMORROW, [
      { wp: "wp-n1", crew: { workerIds: ["b1"], lead: null } },
    ]);
  });

  it("เพิ่มงานเข้าแผน adds a leaf WP to the selected day's board", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /เพิ่มงานเข้าแผน/ }));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: /WP-X/ }));
    expect(mockAddItem).toHaveBeenCalledWith(PROJECT, TODAY, "wp-x");
  });

  it("the picker hides WPs already on the selected day's board", async () => {
    const user = userEvent.setup();
    render(
      <TeamMapView
        projectId={PROJECT}
        map={MAP}
        addableStaff={[]}
        currentUserId="u-x"
        dayPlans={DAY_PLANS}
        planWps={[...PLAN_WPS, { id: "wp-t1", code: "WP-t1", name: "งานt1" }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /เพิ่มงานเข้าแผน/ }));
    const sheet = screen.getByRole("dialog");
    // wp-t1 is already a board item today — offering it again would be a
    // success-toasted no-op (add_daily_plan_item is on-conflict-do-nothing).
    expect(within(sheet).queryByRole("button", { name: /WP-t1/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /WP-X/ })).toBeInTheDocument();
  });

  it("the §2.4 money filter strips a contractor-tied member from the plan write", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(within(screen.getByTestId("wp-tray")).getByRole("button", { name: /WP-t1/ }));
    await user.click(
      within(screen.getByTestId("team-card-cr-c")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    );
    // cx (contractor-tied) must NEVER reach daily_work_plan_crew — it feeds
    // mark-present → log_labor_day → payroll.
    expect(mockApply).toHaveBeenCalledWith(PROJECT, TODAY, [
      { wp: "wp-t1", crew: { workerIds: ["c1"], lead: null } },
    ]);
  });

  it("a failed placement surfaces an error toast (no sheet is open to show it)", async () => {
    mockApply.mockResolvedValueOnce({ ok: false, error: "ไม่มีสิทธิ์" });
    const user = userEvent.setup();
    renderView();
    await user.click(within(screen.getByTestId("wp-tray")).getByRole("button", { name: /WP-t1/ }));
    await user.click(
      within(screen.getByTestId("team-card-cr-a")).getByRole("button", { name: /วางที่ทีมนี้/ }),
    );
    expect(mockToastError).toHaveBeenCalledWith("ไม่มีสิทธิ์");
  });
});
