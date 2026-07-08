// Spec 282 U2 (approach A) — the pure bucket builder behind the SA site team board.
// Takes the buildCrewTeams output (teams + unassigned) + each crew's kind + each
// worker's contractor_id + the ฝ่ายไซต์ members (the U1 definer read) and produces
// the bucketed board: ทีมภายใน (our workers crews) · ทีมภายนอก (subcon crews) ·
// ฝ่ายไซต์ (site_admin/site_owner) · ยังไม่ได้จัดทีม, a total headcount, and the
// per-member cross-charge exception badges (approach A annotates, never reclassifies).
// RED-first.

import { describe, expect, it } from "vitest";
import { buildSiteTeamBoard, type SiteTeamBoardInput } from "@/lib/sa/site-team-board";
import type { CrewTeam, CrewTeamMember } from "@/components/features/sa/crew-team-roster";

const member = (id: string, name = id): CrewTeamMember => ({ id, name, level: null });
const team = (id: string, members: CrewTeamMember[], name = id): CrewTeam => ({
  id,
  name,
  leadName: null,
  members,
});

function base(overrides: Partial<SiteTeamBoardInput> = {}): SiteTeamBoardInput {
  return {
    teams: [],
    unassigned: [],
    crewKindById: new Map(),
    contractorByWorker: new Map(),
    siteAccess: [],
    ...overrides,
  };
}

describe("buildSiteTeamBoard — bucketing", () => {
  it("splits teams into ทีมภายใน (non-subcon) and ทีมภายนอก (kind=subcon)", () => {
    const board = buildSiteTeamBoard(
      base({
        teams: [team("C1", [member("w1")]), team("C2", [member("w2")])],
        crewKindById: new Map([
          ["C1", "dc"],
          ["C2", "subcon"],
        ]),
      }),
    );
    expect(board.internal.map((t) => t.id)).toEqual(["C1"]);
    expect(board.external.map((t) => t.id)).toEqual(["C2"]);
  });

  it("treats a crew of unknown/missing kind as internal", () => {
    const board = buildSiteTeamBoard(
      base({ teams: [team("C1", [member("w1")])], crewKindById: new Map() }),
    );
    expect(board.internal.map((t) => t.id)).toEqual(["C1"]);
    expect(board.external).toEqual([]);
  });

  it("passes the ฝ่ายไซต์ members and the unassigned bucket through", () => {
    const board = buildSiteTeamBoard(
      base({
        unassigned: [member("w9")],
        siteAccess: [{ userId: "u1", name: "เอสเอ" }],
      }),
    );
    expect(board.unassigned.map((m) => m.id)).toEqual(["w9"]);
    expect(board.siteAccess).toEqual([{ userId: "u1", name: "เอสเอ" }]);
  });
});

describe("buildSiteTeamBoard — total headcount", () => {
  it("counts every team member + unassigned + ฝ่ายไซต์", () => {
    const board = buildSiteTeamBoard(
      base({
        teams: [team("C1", [member("w1"), member("w2")]), team("C2", [member("w3")])],
        crewKindById: new Map([["C2", "subcon"]]),
        unassigned: [member("w4")],
        siteAccess: [{ userId: "u1", name: "เอสเอ" }],
      }),
    );
    expect(board.total).toBe(5); // 3 crew + 1 loose + 1 site-access
  });
});

describe("buildSiteTeamBoard — cross-charge exception badges (approach A)", () => {
  it("flags an internal-team member with a contractor_id as ช่างนอกในทีมเรา", () => {
    const board = buildSiteTeamBoard(
      base({
        teams: [team("C1", [member("w1")])],
        crewKindById: new Map([["C1", "dc"]]),
        contractorByWorker: new Map([["w1", "sub-123"]]),
      }),
    );
    expect(board.internal[0]!.members[0]!.exception).toBe("subcon_internal");
  });

  it("flags an external-team member with NO contractor_id as ช่างเราในทีมนอก", () => {
    const board = buildSiteTeamBoard(
      base({
        teams: [team("C2", [member("w2")])],
        crewKindById: new Map([["C2", "subcon"]]),
        contractorByWorker: new Map([["w2", null]]),
      }),
    );
    expect(board.external[0]!.members[0]!.exception).toBe("our_tech_external");
  });

  it("leaves a matching member (our worker on our team) unflagged", () => {
    const board = buildSiteTeamBoard(
      base({
        teams: [team("C1", [member("w1")])],
        crewKindById: new Map([["C1", "dc"]]),
        contractorByWorker: new Map([["w1", null]]),
      }),
    );
    expect(board.internal[0]!.members[0]!.exception).toBeUndefined();
  });

  it("leaves a matching member (subcon worker on a subcon team) unflagged", () => {
    const board = buildSiteTeamBoard(
      base({
        teams: [team("C2", [member("w2")])],
        crewKindById: new Map([["C2", "subcon"]]),
        contractorByWorker: new Map([["w2", "sub-123"]]),
      }),
    );
    expect(board.external[0]!.members[0]!.exception).toBeUndefined();
  });

  it("preserves the งาน chips and lead on a bucketed team", () => {
    const t: CrewTeam = {
      id: "C1",
      name: "ทีมเอ",
      leadName: "หัวหน้า",
      members: [member("w1")],
      workPackages: [{ id: "wp1", code: "P-1", name: "งาน", categoryCode: "W01" }],
    };
    const board = buildSiteTeamBoard(base({ teams: [t], crewKindById: new Map([["C1", "dc"]]) }));
    expect(board.internal[0]!.leadName).toBe("หัวหน้า");
    expect(board.internal[0]!.workPackages).toHaveLength(1);
  });
});
