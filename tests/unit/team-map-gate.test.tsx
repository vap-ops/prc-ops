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

// ── The staff tier moved with it ─────────────────────────────────────────────
//
// First cut kept project MEMBERSHIP with the PM and hid those affordances,
// because addProjectMember / removeProjectMember / setPrimaryProjectFor all
// refused anyone outside PM_ROLES. The operator then answered the surfaced
// question — *"yes, she can manage project members"*, then *"yes, allow her"*
// for the SA หลัก — so the refusing layers moved instead of the buttons:
// migration 20260813075856 widens the two `project_members` write policies and
// `set_primary_project_for`'s allowlist, and the action gate follows.
//
// The rule that survives either answer: an affordance and every layer that can
// refuse it move TOGETHER, or the user meets a button that bounces.

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
      // NOT the primary SA — otherwise ตั้งเป็น SA หลัก never renders for anyone
      // and the gate assertions below would pass for the wrong reason.
      isPrimary: false,
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

// No role prop any more: the operator put teams, membership AND the SA หลัก
// under whoever reaches this page, so every affordance follows the page gate.
// A flag every caller passes `true` is not a gate — it is rot waiting to be
// misread.
const renderMap = () =>
  render(
    <TeamMapView projectId={PROJECT_ID} map={STAFF_MAP} addableStaff={[]} currentUserId="u-pm" />,
  );

afterEach(cleanup);

describe("everything on the page follows page reach", () => {
  it("ตั้งทีมใหม่ renders", () => {
    renderMap();
    expect(screen.getByRole("button", { name: /ตั้งทีมใหม่/ })).toBeInTheDocument();
  });
});

// ── Project membership follows the same directive ────────────────────────────
//
// Operator, 2026-07-26, after #766: *"yes, she can manage project members."*
// addProjectMember / removeProjectMember write `project_members` DIRECTLY under
// the caller's session client — no DEFINER RPC — so the server-action gate and
// the RLS write policies must widen TOGETHER with the affordance. The migration
// (20260813075856) carries the policy half; pgTAP 361 asserts it.
//
// `ตั้งเป็น SA หลัก` widens too (operator, same exchange: *"yes, allow her"*) —
// that one is a DEFINER RPC, so the same migration adds procurement_manager to
// `set_primary_project_for`'s allowlist and NOTHING else: can_see_project and
// the target-must-be-a-site_admin-member guard stay, or the call would become
// "promote any user on any project".

describe("project membership widens with the team map (operator 2026-07-26)", () => {
  it("the member gate uses TEAM_MAP_ROLES — and the rest of project settings does not", () => {
    const actions = read("src/app/projects/[projectId]/settings/actions.ts");
    // Scoped to gateProjectMember's own body: the file's OTHER gates
    // (updateProjectSettings, the client writes) stay PM-only on purpose, so a
    // file-wide absence assertion would be wrong, not strict.
    const gate = actions.slice(
      actions.indexOf("async function gateProjectMember"),
      actions.indexOf("export async function addProjectMember"),
    );
    expect(gate).toMatch(/!TEAM_MAP_ROLES\.includes\(effectiveRole\)/);
    expect(gate).not.toMatch(/PM_ROLES/);
    // …and the settings gate is untouched, so the widening did not leak.
    expect(actions).toMatch(/!PM_ROLES\.includes\(effectiveRole\)/);
  });

  it("the RLS write policies admit her too — the action gate is not the only layer", () => {
    const mig = read("supabase/migrations/20260813075856_project_members_procurement_manager.sql");
    // both write policies, and the two properties a widening must not lose
    expect(mig).toMatch(/for insert[\s\S]*procurement_manager/i);
    expect(mig).toMatch(/for delete[\s\S]*procurement_manager/i);
    expect(mig).toMatch(/added_by = \(select auth\.uid\(\)\)/);
    expect((mig.match(/\(select public\.current_user_role\(\)\)/g) ?? []).length).toBe(2);
    // plain procurement is NOT in the directive
    expect(mig).not.toMatch(/'procurement'::public\.user_role/);
  });

  it("the SA-หลัก RPC widens by ALLOWLIST ONLY — its other guards survive", () => {
    const mig = read("supabase/migrations/20260813075856_project_members_procurement_manager.sql");
    const fn = mig.slice(mig.indexOf("create or replace function public.set_primary_project_for"));
    expect(fn).toMatch(
      /'project_manager', 'project_director', 'super_admin', 'procurement_manager'/,
    );
    // The three guards a careless rewrite would drop, each still present.
    expect(fn).toMatch(/v_role is null/);
    expect(fn).toMatch(/can_see_project\(p_project\)/);
    expect(fn).toMatch(/u\.role = 'site_admin'/);
    // …and the demote-then-promote pair that keeps ONE primary per user.
    expect((fn.match(/set is_primary = (false|true)/g) ?? []).length).toBe(2);
  });

  it("she sees เพิ่มสมาชิก, ถอดออกจากทีมโครงการ and ตั้งเป็น SA หลัก", async () => {
    const user = userEvent.setup();
    renderMap();
    expect(screen.getAllByRole("button", { name: /เพิ่มสมาชิก/ }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /อรปรีญา/ }));
    expect(screen.getByRole("button", { name: /ถอดออกจากทีมโครงการ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ตั้งเป็น SA หลัก/ })).toBeInTheDocument();
  });

  it("no role flag survives on the view — page reach is the whole gate", () => {
    const view = read("src/components/features/team-map/team-map-view.tsx");
    expect(view).not.toMatch(/canManageStaff|canSetPrimarySa/);
    const page = read("src/app/projects/[projectId]/team/page.tsx");
    expect(page).not.toMatch(/canManageStaff|canSetPrimarySa/);
  });
});
