import { describe, it, expect } from "vitest";

// Spec 279 U7b — buildCrewTeams shapes the /sa/crew crew (team) grouping from the
// three RLS-scoped reads (active workers on the SA's projects, active crews,
// active crew_members) into what CrewTeamRoster renders: each crew with its lead
// name + members, plus the workers on no crew. Pure logic — the RLS scoping is
// the migration's job; this only groups what it is handed.

import { buildCrewTeams } from "@/lib/sa/crew-teams";

const w = (id: string, name: string, level: "senior" | "mid" | null = null) => ({
  id,
  name,
  level,
});

describe("buildCrewTeams", () => {
  it("groups a worker under their crew", () => {
    const result = buildCrewTeams(
      [w("w1", "ลูกทีม")],
      [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      [{ crew_id: "c1", worker_id: "w1" }],
    );
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]?.members.map((m) => m.id)).toEqual(["w1"]);
    expect(result.unassigned).toEqual([]);
  });

  it("resolves the crew lead's name from lead_worker_id", () => {
    const result = buildCrewTeams(
      [w("lead1", "หัวหน้าต้า")],
      [{ id: "c1", name: "ทีม A", lead_worker_id: "lead1" }],
      [],
    );
    expect(result.teams[0]?.leadName).toBe("หัวหน้าต้า");
  });

  it("leaves leadName null when the crew has no lead", () => {
    const result = buildCrewTeams([], [{ id: "c1", name: "ทีม A", lead_worker_id: null }], []);
    expect(result.teams[0]?.leadName).toBeNull();
  });

  it("leaves leadName null when the lead worker is not in the visible set", () => {
    const result = buildCrewTeams(
      [], // lead worker row absent (inactive / off-project)
      [{ id: "c1", name: "ทีม A", lead_worker_id: "ghost" }],
      [],
    );
    expect(result.teams[0]?.leadName).toBeNull();
  });

  it("puts a worker on no crew into unassigned", () => {
    const result = buildCrewTeams([w("w1", "ช่างเดี่ยว")], [], []);
    expect(result.teams).toEqual([]);
    expect(result.unassigned.map((m) => m.id)).toEqual(["w1"]);
  });

  it("does NOT list a crew lead as unassigned even if they are not a member row", () => {
    // lead1 leads c1 but has no crew_members row → still 'on a team', not loose.
    const result = buildCrewTeams(
      [w("lead1", "หัวหน้า"), w("w2", "ลูกทีม")],
      [{ id: "c1", name: "ทีม A", lead_worker_id: "lead1" }],
      [{ crew_id: "c1", worker_id: "w2" }],
    );
    expect(result.unassigned.map((m) => m.id)).toEqual([]);
  });

  it("preserves the given worker order within a crew and in unassigned", () => {
    const result = buildCrewTeams(
      [w("a", "ก"), w("b", "ข"), w("c", "ค"), w("d", "ง")],
      [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      [
        { crew_id: "c1", worker_id: "c" },
        { crew_id: "c1", worker_id: "a" },
      ],
    );
    // members follow the input worker order (a before c), not the member-row order.
    expect(result.teams[0]?.members.map((m) => m.id)).toEqual(["a", "c"]);
    expect(result.unassigned.map((m) => m.id)).toEqual(["b", "d"]);
  });

  it("carries each member's level through", () => {
    const result = buildCrewTeams(
      [w("w1", "สมชาย", "senior")],
      [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      [{ crew_id: "c1", worker_id: "w1" }],
    );
    expect(result.teams[0]?.members[0]?.level).toBe("senior");
  });

  it("returns empty teams and unassigned for empty input", () => {
    expect(buildCrewTeams([], [], [])).toEqual({ teams: [], unassigned: [] });
  });
});
