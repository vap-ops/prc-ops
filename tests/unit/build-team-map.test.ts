// Spec 330 U1 — pure builder for the per-project team map (ทีมงานโครงการ).
// Tiers: management (lead ★ first) → site (primary SA first) → teams
// (crew cards w/ lead chip first, firm cards, ยังไม่จัดทีม pool last).
import { describe, expect, it } from "vitest";

import { buildProjectTeamMap } from "@/lib/team-map/build-team-map";

const users = new Map([
  ["u-pm", { name: "สมชาย ใจดี", role: "project_manager" }],
  ["u-pd", { name: "วรรณา สืบสาย", role: "project_director" }],
  ["u-sa1", { name: "อรปรีญา เงางาม", role: "site_admin" }],
  ["u-sa2", { name: "ประวิทย์ คงมั่น", role: "site_admin" }],
  ["u-own", { name: "นภา ตั้งตรง", role: "site_owner" }],
]);

const workers = [
  { id: "w-lead", name: "แก้ว บุญวัง", contractor_id: null },
  { id: "w-a", name: "ภานุพงษ์", contractor_id: null },
  { id: "w-b", name: "สมหวัง", contractor_id: null },
  { id: "w-firm1", name: "อวย", contractor_id: "c-uay" },
  { id: "w-firm2", name: "มานะ", contractor_id: "c-uay" },
  { id: "w-loose", name: "สงกรานต์", contractor_id: null },
];

const crews = [
  { id: "cr-1", name: "ทีมปูน", lead_worker_id: "w-lead", active: true },
  { id: "cr-dead", name: "ทีมยุบแล้ว", lead_worker_id: null, active: false },
];

const crewMembers = [
  { crew_id: "cr-1", worker_id: "w-lead", removed_at: null },
  { crew_id: "cr-1", worker_id: "w-a", removed_at: null },
  { crew_id: "cr-1", worker_id: "w-b", removed_at: "2026-07-01" },
  { crew_id: "cr-dead", worker_id: "w-b", removed_at: null },
];

const contractors = new Map([["c-uay", "ทีมช่างอวย"]]);

function build(overrides: Partial<Parameters<typeof buildProjectTeamMap>[0]> = {}) {
  return buildProjectTeamMap({
    projectLeadId: "u-pm",
    members: [
      { user_id: "u-pm", is_primary: false },
      { user_id: "u-pd", is_primary: false },
      { user_id: "u-sa1", is_primary: true },
      { user_id: "u-sa2", is_primary: false },
      { user_id: "u-own", is_primary: false },
    ],
    users,
    workers,
    crews,
    crewMembers,
    contractors,
    ...overrides,
  });
}

describe("buildProjectTeamMap (spec 330)", () => {
  it("management tier: lead first with isLead, PM/PD roles only", () => {
    const map = build();
    expect(map.management.map((n) => n.userId)).toEqual(["u-pm", "u-pd"]);
    expect(map.management[0]).toMatchObject({ isLead: true, isMember: true });
    expect(map.management[1]).toMatchObject({ isLead: false });
  });

  it("includes a non-member project lead in management with isMember=false", () => {
    const map = build({
      projectLeadId: "u-ext",
      users: new Map([...users, ["u-ext", { name: "หัวหน้านอกทีม", role: "project_manager" }]]),
    });
    const lead = map.management.find((n) => n.userId === "u-ext");
    expect(lead).toMatchObject({ isLead: true, isMember: false });
    expect(map.management[0]?.userId).toBe("u-ext");
  });

  it("a site_admin project lead renders ONCE (site tier, isLead), no phantom management node", () => {
    // Fresh-eyes catch: the settings lead picker offers site_admins too. A
    // site-role lead must not spawn a duplicate isMember=false management row.
    const map = build({ projectLeadId: "u-sa1" });
    expect(map.management.some((n) => n.userId === "u-sa1")).toBe(false);
    expect(map.management.map((n) => n.userId)).toEqual(["u-pm", "u-pd"]);
    const lead = map.site.find((n) => n.userId === "u-sa1");
    expect(lead).toMatchObject({ isLead: true, isMember: true });
  });

  it("exposes the true project_members count for the removal guard", () => {
    expect(build().memberCount).toBe(5);
  });

  it("site tier: primary SA first, then SA and site_owner members", () => {
    const map = build();
    expect(map.site.map((n) => n.userId)).toEqual(["u-sa1", "u-sa2", "u-own"]);
    expect(map.site[0]?.isPrimary).toBe(true);
  });

  it("crew card: active crews only, lead chip first, soft-removed members excluded", () => {
    const map = build();
    const crew = map.teams.find((t) => t.kind === "crew");
    expect(crew).toBeDefined();
    expect(crew?.name).toBe("ทีมปูน");
    expect(crew?.members.map((m) => m.workerId)).toEqual(["w-lead", "w-a"]);
    expect(crew?.members[0]?.isTeamLead).toBe(true);
    expect(crew?.count).toBe(2);
    expect(map.teams.some((t) => t.id === "cr-dead")).toBe(false);
  });

  it("firm card: groups contractor workers not in an active crew", () => {
    const map = build();
    const firm = map.teams.find((t) => t.kind === "firm");
    expect(firm).toMatchObject({ id: "c-uay", name: "ทีมช่างอวย", count: 2 });
    expect(firm?.members.map((m) => m.workerId)).toEqual(["w-firm1", "w-firm2"]);
  });

  // Every chip carries the worker's own contractor_id. The card's `kind` cannot
  // stand in for it: the moment a contractor-tied worker sits in a crew the
  // card reads "crew", so a UI money wall keyed on kind would wave them
  // through. Asserting the EMITTED value means hardcoding `contractorId: null`
  // on crew chips can no longer disarm that wall with the suite still green.
  it("emits each chip's own contractorId — including inside a CREW card", () => {
    const map = build({
      crewMembers: [
        { crew_id: "cr-1", worker_id: "w-lead", removed_at: null },
        { crew_id: "cr-1", worker_id: "w-firm2", removed_at: null },
      ],
    });
    const crew = map.teams.find((t) => t.kind === "crew");
    expect(crew?.members).toEqual([
      expect.objectContaining({ workerId: "w-lead", contractorId: null }),
      expect.objectContaining({ workerId: "w-firm2", contractorId: "c-uay" }),
    ]);
    expect(map.teams.find((t) => t.kind === "firm")?.members.map((m) => m.contractorId)).toEqual([
      "c-uay",
    ]);
    expect(
      map.teams.find((t) => t.kind === "unassigned")?.members.every((m) => m.contractorId === null),
    ).toBe(true);
  });

  it("unassigned pool: project workers in no active crew and no firm, last card", () => {
    const map = build();
    const pool = map.teams[map.teams.length - 1];
    // w-b's only active membership is in an inactive crew → falls to the pool.
    expect(pool?.kind).toBe("unassigned");
    expect(pool?.members.map((m) => m.workerId).sort()).toEqual(["w-b", "w-loose"]);
  });

  it("omits the unassigned card when every worker has a team", () => {
    const map = build({
      workers: workers.filter((w) => w.id !== "w-loose" && w.id !== "w-b"),
    });
    expect(map.teams.some((t) => t.kind === "unassigned")).toBe(false);
  });

  it("sums: crewTotal counts all project workers, teamCount excludes the pool", () => {
    const map = build();
    expect(map.crewTotal).toBe(6);
    expect(map.teamCount).toBe(2);
  });
});
