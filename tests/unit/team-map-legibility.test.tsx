// Spec 338 — team-map legibility. U1: contractor-card identity (firm cards
// visually distinct at card AND chip grain) + the 3-tier button hierarchy
// (primary bg-action · secondary bordered · danger text-danger). Asserts run
// against the RENDERED DOM (className of real elements), never source text —
// the mutation-check reverts one tier class and expects exactly one red.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    error: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { TeamMapView } from "@/components/features/team-map/team-map-view";
import { TRADE_MISMATCH_HINT } from "@/lib/i18n/labels";
import type { ProjectTeamMap } from "@/lib/team-map/build-team-map";
import type { WorkerTrade } from "@/lib/workers/trades";
import type { DayPlanWpItem, TeamMapDayPlan } from "@/lib/work-plans/day-assignments";

const PROJECT = "11111111-1111-4111-8111-111111111111";

const MAP: ProjectTeamMap = {
  management: [],
  site: [],
  teams: [
    {
      kind: "crew",
      id: "cr-1",
      name: "ทีมลุงจันทร์",
      members: [
        { workerId: "w-l", name: "จันทร์", isTeamLead: true, contractorId: null },
        { workerId: "w-m", name: "ภานุพงษ์", isTeamLead: false, contractorId: null },
      ],
      count: 2,
    },
    {
      kind: "firm",
      id: "firm-1",
      name: "ช่างอวย",
      members: [{ workerId: "w-f", name: "อวย ดีใจ", isTeamLead: false, contractorId: "firm-1" }],
      count: 1,
    },
    {
      kind: "unassigned",
      id: "unassigned",
      name: "ยังไม่จัดทีม",
      members: [{ workerId: "w-p", name: "แดง บุญวัง", isTeamLead: false, contractorId: null }],
      count: 1,
    },
  ],
  crewTotal: 4,
  teamCount: 2,
  memberCount: 0,
};

const trade = (code: string, isPrimary = false): WorkerTrade => ({
  categoryId: `id-${code}`,
  code,
  nameTh: `หมวด ${code}`,
  isPrimary,
});

const TRADES: Record<string, WorkerTrade[]> = {
  "w-l": [trade("W01", true), trade("W05")],
  "w-m": [trade("W03", true), trade("W06")],
  "w-p": [trade("W02")],
};

function renderView(tradesByWorker?: Record<string, WorkerTrade[]>) {
  return render(
    <TeamMapView
      projectId={PROJECT}
      map={MAP}
      addableStaff={[]}
      currentUserId="u-x"
      {...(tradesByWorker ? { tradesByWorker } : {})}
    />,
  );
}

afterEach(cleanup);

describe("team map legibility — U1 contractor identity (spec 338)", () => {
  it("a firm card carries the ผู้รับเหมา badge in its header; a crew card does not", () => {
    renderView();
    const firm = screen.getByTestId("team-card-firm-1");
    expect(within(firm).getByText("ผู้รับเหมา")).toBeInTheDocument();
    const crew = screen.getByTestId("team-card-cr-1");
    expect(within(crew).queryByText("ผู้รับเหมา")).not.toBeInTheDocument();
  });

  it("firm member chips render dashed-outline; crew member chips stay solid", async () => {
    const user = userEvent.setup();
    renderView();
    const firm = screen.getByTestId("team-card-firm-1");
    await user.click(within(firm).getByRole("button", { name: /^แสดง$/ }));
    const firmChip = within(firm).getByRole("button", { name: /อวย ดีใจ/ });
    expect(firmChip.className).toContain("border-dashed");

    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /^แสดง$/ }));
    const crewChip = within(crew).getByRole("button", { name: /ภานุพงษ์/ });
    expect(crewChip.className).not.toContain("border-dashed");
  });
});

describe("team map legibility — U1 button hierarchy (spec 338)", () => {
  it("ตั้งทีมใหม่ (tier header) and สร้างทีม (create sheet) are primary bg-action", async () => {
    const user = userEvent.setup();
    renderView();
    const crewTier = screen.getByRole("region", { name: /ทีมช่าง/ });
    const newTeam = within(crewTier).getByRole("button", { name: /ตั้งทีมใหม่/ });
    expect(newTeam.className).toContain("bg-action");
    await user.click(newTeam);
    const create = within(screen.getByRole("dialog")).getByRole("button", { name: /สร้างทีม/ });
    expect(create.className).toContain("bg-action");
  });

  it("ยุบทีม renders as danger while บันทึกชื่อ is the sheet's primary", async () => {
    const user = userEvent.setup();
    renderView();
    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /จัดการทีม/ }));
    const sheet = screen.getByRole("dialog");
    const dissolve = within(sheet).getByRole("button", { name: /ยุบทีม/ });
    expect(dissolve.className).toContain("text-danger");
    const save = within(sheet).getByRole("button", { name: /บันทึกชื่อ/ });
    expect(save.className).toContain("bg-action");
    expect(save.className).not.toContain("text-danger");
  });

  it("นำออกจากทีม (worker chip sheet) renders as danger", async () => {
    const user = userEvent.setup();
    renderView();
    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /^แสดง$/ }));
    await user.click(within(crew).getByRole("button", { name: /ภานุพงษ์/ }));
    const sheet = screen.getByRole("dialog");
    const remove = within(sheet).getByRole("button", { name: /นำออกจากทีม/ });
    expect(remove.className).toContain("text-danger");
    // The constructive sibling in the same sheet must NOT be danger.
    const lead = within(sheet).getByRole("button", { name: /ตั้งเป็นหัวหน้าทีม/ });
    expect(lead.className).not.toContain("text-danger");
  });
});

describe("team map legibility — U2 trades on the map (spec 338)", () => {
  it("a collapsed crew card shows its lead line: name + primary-first tiles", () => {
    renderView(TRADES);
    const crew = screen.getByTestId("team-card-cr-1");
    // WITHOUT expanding: the lead is visible (pain-2 fix; supersedes the U1
    // "collapsed shows counts only" rule for the lead alone).
    const line = within(crew).getByTestId("collapsed-lead-line");
    expect(line).toHaveTextContent("จันทร์");
    const tiles = within(line).getAllByRole("img");
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["W01", "W05"]);
  });

  it("the expanded lead band carries the lead's tiles primary-first", async () => {
    const user = userEvent.setup();
    renderView(TRADES);
    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /^แสดง$/ }));
    const band = within(crew).getByTestId("crew-lead-band");
    const tiles = within(band).getAllByRole("img");
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["W01", "W05"]);
  });

  it("member and pool chips show the FIRST (primary) tile only; no-trade workers show none", async () => {
    const user = userEvent.setup();
    renderView(TRADES);
    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /^แสดง$/ }));
    const member = within(crew).getByRole("button", { name: /ภานุพงษ์/ });
    const memberTiles = within(member).getAllByRole("img");
    expect(memberTiles.map((t) => t.getAttribute("aria-label"))).toEqual(["W03"]);

    const pool = screen.getByTestId("team-card-unassigned");
    await user.click(within(pool).getByRole("button", { name: /^แสดง$/ }));
    const poolChip = within(pool).getByRole("button", { name: /แดง บุญวัง/ });
    expect(
      within(poolChip)
        .getAllByRole("img")
        .map((t) => t.getAttribute("aria-label")),
    ).toEqual(["W02"]);

    const firm = screen.getByTestId("team-card-firm-1");
    await user.click(within(firm).getByRole("button", { name: /^แสดง$/ }));
    const noTrades = within(firm).getByRole("button", { name: /อวย ดีใจ/ });
    expect(within(noTrades).queryAllByRole("img")).toHaveLength(0);
  });

  it("the worker chip sheet lists all trades with Thai names and links to the /workers editor", async () => {
    const user = userEvent.setup();
    renderView(TRADES);
    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /^แสดง$/ }));
    await user.click(within(crew).getByRole("button", { name: /ภานุพงษ์/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("หมวด W03")).toBeInTheDocument();
    expect(within(sheet).getByText("หมวด W06")).toBeInTheDocument();
    const editLink = within(sheet).getByRole("link", { name: /แก้ไขสายงานที่รายชื่อช่าง/ });
    expect(editLink).toHaveAttribute("href", "/workers");
  });

  it("without the trades prop the lead line still shows (pain-2 fix stands alone) but zero tiles", () => {
    renderView();
    const crew = screen.getByTestId("team-card-cr-1");
    expect(within(crew).getByTestId("collapsed-lead-line")).toHaveTextContent("จันทร์");
    expect(within(crew).queryAllByRole("img")).toHaveLength(0);
  });
});

// U3 — the placing trade-mismatch hint. Lead of cr-1 (จันทร์) carries W01+W05;
// an item in another category hints, a matching or unknown one stays silent,
// and the drop target NEVER disables.
describe("team map legibility — U3 placing hint (spec 338)", () => {
  const item = (id: string, categoryCode: string | null, workerIds: string[]): DayPlanWpItem => ({
    itemId: `it-${id}`,
    workPackageId: `wp-${id}`,
    code: `W03-${id}`,
    name: `งาน${id}`,
    workerIds,
    categoryCode,
  });

  const dayPlans = (
    items: DayPlanWpItem[],
  ): { today: TeamMapDayPlan; tomorrow: TeamMapDayPlan } => ({
    today: { date: "2026-07-22", items },
    tomorrow: { date: "2026-07-23", items: [] },
  });

  function renderWithPlan(items: DayPlanWpItem[]) {
    return render(
      <TeamMapView
        projectId={PROJECT}
        map={MAP}
        addableStaff={[]}
        currentUserId="u-x"
        tradesByWorker={TRADES}
        dayPlans={dayPlans(items)}
        planWps={[]}
      />,
    );
  }

  it("placing a mismatching WP shows the hint + its category tile; the drop stays enabled", async () => {
    const user = userEvent.setup();
    renderWithPlan([item("a", "W03", [])]);
    await user.click(screen.getByRole("button", { name: /W03-a/ }));
    const crew = screen.getByTestId("team-card-cr-1");
    const hint = within(crew).getByText(TRADE_MISMATCH_HINT);
    expect(hint).toBeInTheDocument();
    expect(
      within(crew)
        .getAllByRole("img")
        .some((t) => t.getAttribute("aria-label") === "W03"),
    ).toBe(true);
    const drop = within(crew).getByRole("button", { name: /วางที่ทีมนี้/ });
    expect(drop).toBeEnabled();
  });

  it("a matching WP (subsection resolves to the lead's top) shows no hint", async () => {
    const user = userEvent.setup();
    renderWithPlan([item("b", "W0102", [])]);
    await user.click(screen.getByRole("button", { name: /W03-b/ }));
    const crew = screen.getByTestId("team-card-cr-1");
    expect(within(crew).queryByText(TRADE_MISMATCH_HINT)).not.toBeInTheDocument();
    expect(within(crew).getByRole("button", { name: /วางที่ทีมนี้/ })).toBeEnabled();
  });

  it("an uncategorised WP shows no hint (cannot claim a mismatch)", async () => {
    const user = userEvent.setup();
    renderWithPlan([item("c", null, [])]);
    await user.click(screen.getByRole("button", { name: /W03-c/ }));
    const crew = screen.getByTestId("team-card-cr-1");
    expect(within(crew).queryByText(TRADE_MISMATCH_HINT)).not.toBeInTheDocument();
  });

  it("the assigned plan-chip sheet carries the same hint on mismatch", async () => {
    const user = userEvent.setup();
    // Full-crew overlap with cr-1 (w-l + w-m) → renders as that team's chip.
    renderWithPlan([item("d", "W03", ["w-l", "w-m"])]);
    const crew = screen.getByTestId("team-card-cr-1");
    await user.click(within(crew).getByRole("button", { name: /W03-d/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText(TRADE_MISMATCH_HINT)).toBeInTheDocument();
  });
});
