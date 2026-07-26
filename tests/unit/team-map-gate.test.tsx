// Writing failing test first.
//
// The per-project team map (`/projects/:id/team`) is the ONLY surface that can
// create a crew, set a หัวหน้าทีม, or move a worker between crews — and it was
// gated on PM_ROLES, which excludes procurement_manager.
//
// That is an affordance gap, not a privilege one: all seven crew RPCs behind the
// screen gate on `is_back_office()` (verified live 2026-07-26), which has
// admitted procurement AND procurement_manager since spec 261, and the
// `crews` / `crew_members` SELECT policies use the same predicate. The database
// already says yes; only the page said no.
//
// It cost real data on 2026-07-26: the morning report listed five DC teams but
// only four crews existed, so ทีมป้าสังวาลย์ could not be opened in เช็คชื่อ and
// her five members were scanned into whichever team was already open — 10 of 17
// DC workers ended up on the wrong team, which is the grain labour cost is
// derived at. The person the operator holds responsible for the on-site teams
// ("Anything regarding the teams on site, Procurement manager is responsible",
// 2026-07-26) could not fix it.
//
// Pins: the new set is EXACTLY PM_ROLES + procurement_manager (iterated over the
// complete role domain, not a hand-list), the widening did NOT leak into
// PM_ROLES or the write/membership sets, and both surfaces — the page gate and
// the cockpit door — actually use it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PM_ROLES,
  PROJECT_TEAM_STAFF_ROLES,
  SITE_STAFF_ROLES,
  TEAM_MAP_ROLES,
  isManagerRole,
  isTeamMapRole,
} from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type UserRole = Database["public"]["Enums"]["user_role"];

// The COMPLETE domain — USER_ROLE_LABEL is a Record<UserRole, string>, so a new
// enum value trips its own exhaustiveness guard and then lands here too. A
// hand-typed list would silently miss the next role added (spec 348 U5 lesson).
const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("TEAM_MAP_ROLES — who may open the per-project team map", () => {
  it("is exactly the PM tier plus procurement_manager", () => {
    expect([...TEAM_MAP_ROLES].sort()).toEqual(
      [...PM_ROLES, "procurement_manager"].sort() as UserRole[],
    );
  });

  it("admits exactly that set across the whole role domain", () => {
    const admitted = ALL_ROLES.filter((r) => isTeamMapRole(r)).sort();
    expect(admitted).toEqual(
      ["project_director", "project_manager", "procurement_manager", "super_admin"].sort(),
    );
  });

  it("does not admit plain procurement, the SA, or any field role", () => {
    for (const role of ["procurement", "site_admin", "technician", "auditor"] as UserRole[]) {
      expect(isTeamMapRole(role)).toBe(false);
    }
  });

  // SAFETY PIN: the widening goes in the NEW set only. PM_ROLES is the manager
  // tier and gates money/approval surfaces far past this page; the *_STAFF sets
  // gate writes, project membership and notification fan-out.
  it("does not leak procurement_manager into the manager or site-staff sets", () => {
    expect(PM_ROLES).not.toContain("procurement_manager");
    expect(SITE_STAFF_ROLES).not.toContain("procurement_manager");
    expect(PROJECT_TEAM_STAFF_ROLES).not.toContain("procurement_manager");
    expect(isManagerRole("procurement_manager")).toBe(false);
  });
});

describe("both team-map surfaces use the set", () => {
  it("the page gates on TEAM_MAP_ROLES, not PM_ROLES", () => {
    const page = read("src/app/projects/[projectId]/team/page.tsx");
    expect(page).toMatch(/^\s*const ctx = await requireRole\(TEAM_MAP_ROLES\);/m);
    expect(page).not.toMatch(/requireRole\(PM_ROLES\)/);
  });

  it("the project-cockpit door renders for the same set", () => {
    const page = read("src/app/projects/[projectId]/page.tsx");
    // The team door moved OUT of the isManagerRole fragment; a door she cannot
    // see is the same defect as a page she cannot open.
    expect(page).toMatch(/isTeamMapRole\(ctx\.role\)[\s\S]{0,400}?projectTeamHref\(project\.id\)/);
  });

  it("leaves the reports and settings doors on the manager gate", () => {
    const page = read("src/app/projects/[projectId]/page.tsx");
    expect(page).toMatch(/isManagerRole\(ctx\.role\)[\s\S]{0,600}?reportsHref\(project\.id\)/);
    expect(page).toMatch(
      /isManagerRole\(ctx\.role\)[\s\S]{0,900}?projectSettingsHref\(project\.id\)/,
    );
  });
});

// ── The staff tier stays the PM's ────────────────────────────────────────────
//
// Reaching the page is not the same as owning everything on it. The operator's
// directive is about the TEAMS on site; project MEMBERSHIP (who is on the
// project, who is the SA หลัก) stays a manager decision — and its actions prove
// it: addProjectMember / removeProjectMember / setPrimaryProjectFor all gate on
// PM_ROLES in the server action, and set_primary_project_for's RPC allows only
// project_manager / project_director / super_admin (verified live 2026-07-26).
//
// So the widening must HIDE those affordances for a non-manager, or it ships the
// exact affordance-then-refuse this repo keeps paying for: a button she can see,
// press, and be refused by.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";

vi.mock("@/lib/team-map/crew-actions", () => ({
  addWorkerToCrew: vi.fn(),
  removeWorkerFromCrew: vi.fn(),
  moveWorkerBetweenCrews: vi.fn(),
  setCrewLead: vi.fn(),
  createCrew: vi.fn(),
  renameCrew: vi.fn(),
  dissolveCrew: vi.fn(),
}));
vi.mock("@/app/projects/[projectId]/settings/actions", () => ({
  addProjectMember: vi.fn(async () => ({ ok: true })),
  removeProjectMember: vi.fn(async () => ({ ok: true })),
  setPrimaryProjectFor: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/sa/plan/actions", () => ({
  addDailyPlanItem: vi.fn(async () => ({ ok: true })),
  applyPlanSuggestions: vi.fn(async () => ({ ok: true })),
  setDailyPlanItemCrew: vi.fn(async () => ({ ok: true })),
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

const { TeamMapView } = await import("@/components/features/team-map/team-map-view");
type ProjectTeamMap = Parameters<typeof TeamMapView>[0]["map"];

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_MAP: ProjectTeamMap = {
  management: [
    {
      userId: "u-pm",
      name: "ผู้จัดการ",
      role: "project_manager",
      isLead: false,
      isMember: true,
      isPrimary: false,
    },
  ],
  site: [
    {
      userId: "u-sa",
      name: "อรปรีญา",
      role: "site_admin",
      isMember: true,
      isPrimary: true,
      isLead: false,
    },
  ],
  teams: [
    {
      kind: "crew",
      id: "cr-1",
      name: "ทีม ช จันทร์",
      members: [{ workerId: "w-1", name: "จันทร์", isTeamLead: true, contractorId: null }],
      count: 1,
    },
  ],
  crewTotal: 1,
  teamCount: 1,
  memberCount: 1,
};

const renderMap = (canManageStaff: boolean) =>
  render(
    <TeamMapView
      projectId={PROJECT_ID}
      map={STAFF_MAP}
      addableStaff={[]}
      currentUserId="u-pm"
      canManageStaff={canManageStaff}
    />,
  );

afterEach(cleanup);

describe("staff-tier affordances follow the manager gate, not page reach", () => {
  it("a manager keeps เพิ่มสมาชิก on the staff tiers", () => {
    renderMap(true);
    expect(screen.getAllByRole("button", { name: /เพิ่มสมาชิก/ }).length).toBeGreaterThan(0);
  });

  it("procurement_manager sees no เพิ่มสมาชิก — its action refuses her", () => {
    renderMap(false);
    expect(screen.queryAllByRole("button", { name: /เพิ่มสมาชิก/ })).toHaveLength(0);
  });

  it("the crew half stays fully hers — ตั้งทีมใหม่ renders either way", () => {
    renderMap(false);
    expect(screen.getByRole("button", { name: /ตั้งทีมใหม่/ })).toBeInTheDocument();
  });

  it("the staff sheet offers no membership actions to her, and says why", async () => {
    const user = userEvent.setup();
    renderMap(false);
    await user.click(screen.getByRole("button", { name: /อรปรีญา/ }));
    expect(screen.queryByRole("button", { name: /ถอดออกจากทีมโครงการ/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ตั้งเป็น SA หลัก/ })).toBeNull();
    expect(screen.getByText(/ทำได้โดยผู้จัดการโครงการเท่านั้น/)).toBeInTheDocument();
  });

  it("a manager still gets both membership actions in that sheet", async () => {
    const user = userEvent.setup();
    renderMap(true);
    await user.click(screen.getByRole("button", { name: /อรปรีญา/ }));
    expect(screen.getByRole("button", { name: /ถอดออกจากทีมโครงการ/ })).toBeInTheDocument();
    expect(screen.queryByText(/ทำได้โดยผู้จัดการโครงการเท่านั้น/)).toBeNull();
  });
});
