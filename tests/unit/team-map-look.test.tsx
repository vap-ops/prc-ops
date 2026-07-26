// Spec 330 U5 — the map-look layer: per-tier header actions (ตั้งทีมใหม่
// un-buried from the add sheet — operator ask 2026-07-19), ⓘ role explainers,
// and the missing-lead affordance on crew cards. Structural/behavioral pins
// only — icons and connector lines are decorative and not asserted.
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
import { TEAM_MAP_ROLE_HELP } from "@/lib/help/team-map-roles";
import type { ProjectTeamMap } from "@/lib/team-map/build-team-map";

const PROJECT = "11111111-1111-4111-8111-111111111111";

const MAP: ProjectTeamMap = {
  management: [
    {
      userId: "u-lead",
      name: "อภิชัย",
      role: "project_director",
      isLead: true,
      isPrimary: false,
      isMember: true,
    },
  ],
  site: [
    {
      userId: "u-sa",
      name: "อรปรีญา",
      role: "site_admin",
      isLead: false,
      isPrimary: true,
      isMember: true,
    },
  ],
  teams: [
    {
      kind: "crew",
      id: "cr-lead",
      name: "ทีมมีหัวหน้า",
      members: [
        { workerId: "w-l", name: "จันทร์", isTeamLead: true, contractorId: null },
        { workerId: "w-m", name: "ภานุพงษ์", isTeamLead: false, contractorId: null },
      ],
      count: 2,
    },
    {
      kind: "crew",
      id: "cr-nolead",
      name: "ทีมไร้หัวหน้า",
      members: [{ workerId: "w-n", name: "อนันต์", isTeamLead: false, contractorId: null }],
      count: 1,
    },
  ],
  crewTotal: 3,
  teamCount: 2,
  memberCount: 2,
};

function renderView() {
  return render(
    <TeamMapView projectId={PROJECT} map={MAP} addableStaff={[]} currentUserId="u-x" />,
  );
}

afterEach(cleanup);

describe("team map — map-look (spec 330 U5)", () => {
  it("ตั้งทีมใหม่ is a visible ทีมช่าง header action, NOT inside the add sheet", async () => {
    const user = userEvent.setup();
    renderView();
    const crewTier = screen.getByRole("region", { name: /ทีมช่าง/ });
    const btn = within(crewTier).getByRole("button", { name: /ตั้งทีมใหม่/ });
    await user.click(btn);
    // Direct: one tap opens the createCrew sheet with its name field.
    expect(
      within(screen.getByRole("dialog")).getByRole("textbox", { name: /ชื่อทีม/ }),
    ).toBeInTheDocument();
  });

  it("the add sheet no longer contains ตั้งทีมใหม่ (staff picker only)", async () => {
    const user = userEvent.setup();
    renderView();
    const mgmtTier = screen.getByRole("region", { name: /ผู้บริหารโครงการ/ });
    await user.click(within(mgmtTier).getByRole("button", { name: /เพิ่มสมาชิก/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: /ตั้งทีมใหม่/ })).not.toBeInTheDocument();
  });

  it("each staff tier header carries its own เพิ่มสมาชิก; the page-bottom CTA is gone", () => {
    renderView();
    const addButtons = screen.getAllByRole("button", { name: /เพิ่มสมาชิก/ });
    expect(addButtons).toHaveLength(2);
    expect(
      within(screen.getByRole("region", { name: /หน้างาน/ })).getByRole("button", {
        name: /เพิ่มสมาชิก/,
      }),
    ).toBeInTheDocument();
  });

  it("each tier ⓘ opens the role-explainer sheet with that tier's help copy", async () => {
    const user = userEvent.setup();
    renderView();
    const siteTier = screen.getByRole("region", { name: /หน้างาน/ });
    await user.click(within(siteTier).getByRole("button", { name: /คำอธิบายบทบาท/ }));
    const sheet = screen.getByRole("dialog");
    const firstSiteEntry = TEAM_MAP_ROLE_HELP.site[0];
    expect(firstSiteEntry).toBeDefined();
    if (firstSiteEntry) {
      expect(within(sheet).getByText(firstSiteEntry.description)).toBeInTheDocument();
    }
  });

  it("a lead-less crew card shows the ยังไม่ตั้งหัวหน้าทีม affordance; tapping expands members", async () => {
    const user = userEvent.setup();
    renderView();
    const card = screen.getByTestId("team-card-cr-nolead");
    // Collapsed: member chip hidden, affordance visible.
    expect(within(card).queryByRole("button", { name: /อนันต์/ })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: /ยังไม่ตั้งหัวหน้าทีม/ }));
    expect(within(card).getByRole("button", { name: /อนันต์/ })).toBeInTheDocument();
  });

  it("a crew card WITH a lead renders the lead band (expanded), not the affordance", async () => {
    const user = userEvent.setup();
    renderView();
    const card = screen.getByTestId("team-card-cr-lead");
    expect(
      within(card).queryByRole("button", { name: /ยังไม่ตั้งหัวหน้าทีม/ }),
    ).not.toBeInTheDocument();
    // The band lives in the EXPANDED member area — U1's locked rule is that a
    // collapsed card shows counts only, never member names.
    await user.click(within(card).getByRole("button", { name: /^แสดง$/ }));
    expect(within(card).getByTestId("crew-lead-band")).toHaveTextContent("จันทร์");
    expect(within(card).getByTestId("crew-lead-band")).toHaveTextContent("หัวหน้าทีม");
  });

  it("header actions stay disambiguated from the per-card controls", () => {
    renderView();
    // The master toggle and per-card toggles/manage buttons must still resolve.
    const crewTier = screen.getByRole("region", { name: /ทีมช่าง/ });
    expect(within(crewTier).getByRole("button", { name: /แสดงทั้งหมด/ })).toBeInTheDocument();
    const card = screen.getByTestId("team-card-cr-lead");
    expect(within(card).getByRole("button", { name: /^แสดง$/ })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /จัดการทีม/ })).toBeInTheDocument();
  });
});
