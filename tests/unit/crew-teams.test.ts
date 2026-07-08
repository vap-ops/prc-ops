import { describe, it, expect } from "vitest";

// Spec 279 U6 — buildCrewTeams shapes the /sa/crew crew (team) view from the
// RLS-scoped reads the page holds. It groups the roster by crew (U7b: lead +
// members, plus the workers on no crew) and, per U6, attaches to each crew:
//   • each member's employment_type (ประจำ/ชั่วคราว — internal vs day-hired), and
//   • the งานย่อย the crew is scheduled on, derived from the แผนพรุ่งนี้ boards
//     (spec 273): a งาน belongs to a crew if any of its roster (members ∪ lead)
//     appears in that งาน's daily_work_plan_crew.
// Pure: the RLS scoping + date window + category resolution are the page's job.

import { buildCrewTeams } from "@/lib/sa/crew-teams";

type Lvl = "senior" | "mid" | "junior" | null;
type Emp = "permanent" | "temporary";
const w = (id: string, name: string, level: Lvl = null, employmentType: Emp = "permanent") => ({
  id,
  name,
  level,
  employmentType,
});

const build = (over: Partial<Parameters<typeof buildCrewTeams>[0]> = {}) =>
  buildCrewTeams({
    workers: [],
    crews: [],
    members: [],
    planItems: [],
    planCrew: [],
    workPackages: [],
    ...over,
  });

describe("buildCrewTeams — grouping (U7b behaviour, object signature)", () => {
  it("groups a worker under their crew", () => {
    const r = build({
      workers: [w("w1", "ลูกทีม")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      members: [{ crew_id: "c1", worker_id: "w1" }],
    });
    expect(r.teams).toHaveLength(1);
    expect(r.teams[0]?.members.map((m) => m.id)).toEqual(["w1"]);
    expect(r.unassigned).toEqual([]);
  });

  it("resolves the crew lead's name from lead_worker_id", () => {
    const r = build({
      workers: [w("lead1", "หัวหน้าต้า")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: "lead1" }],
    });
    expect(r.teams[0]?.leadName).toBe("หัวหน้าต้า");
  });

  it("leaves leadName null when there is no lead or it is unresolvable", () => {
    expect(
      build({ crews: [{ id: "c1", name: "A", lead_worker_id: null }] }).teams[0]?.leadName,
    ).toBeNull();
    expect(
      build({ crews: [{ id: "c1", name: "A", lead_worker_id: "ghost" }] }).teams[0]?.leadName,
    ).toBeNull();
  });

  it("puts a worker on no crew into unassigned", () => {
    const r = build({ workers: [w("w1", "ช่างเดี่ยว")] });
    expect(r.teams).toEqual([]);
    expect(r.unassigned.map((m) => m.id)).toEqual(["w1"]);
  });

  it("does NOT list a crew lead as unassigned even without a member row", () => {
    const r = build({
      workers: [w("lead1", "หัวหน้า"), w("w2", "ลูกทีม")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: "lead1" }],
      members: [{ crew_id: "c1", worker_id: "w2" }],
    });
    expect(r.unassigned.map((m) => m.id)).toEqual([]);
  });

  it("preserves the given worker order in members and unassigned", () => {
    const r = build({
      workers: [w("a", "ก"), w("b", "ข"), w("c", "ค"), w("d", "ง")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      members: [
        { crew_id: "c1", worker_id: "c" },
        { crew_id: "c1", worker_id: "a" },
      ],
    });
    expect(r.teams[0]?.members.map((m) => m.id)).toEqual(["a", "c"]);
    expect(r.unassigned.map((m) => m.id)).toEqual(["b", "d"]);
  });
});

describe("buildCrewTeams — U6 member employment_type", () => {
  it("carries each member's employment_type through", () => {
    const r = build({
      workers: [w("w1", "สมชาย", "mid", "temporary")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      members: [{ crew_id: "c1", worker_id: "w1" }],
    });
    expect(r.teams[0]?.members[0]?.employmentType).toBe("temporary");
  });

  it("carries employment_type onto unassigned workers too", () => {
    const r = build({ workers: [w("w9", "ช่างเดี่ยว", null, "permanent")] });
    expect(r.unassigned[0]?.employmentType).toBe("permanent");
  });
});

describe("buildCrewTeams — U6 งาน (crew work packages from แผนพรุ่งนี้)", () => {
  const wp = (id: string, code: string, name: string, categoryCode: string | null = null) => ({
    id,
    code,
    name,
    categoryCode,
  });

  it("attaches a งาน a crew member is planned on", () => {
    const r = build({
      workers: [w("w1", "A")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      members: [{ crew_id: "c1", worker_id: "w1" }],
      planItems: [{ id: "i1", work_package_id: "wp1" }],
      planCrew: [{ item_id: "i1", worker_id: "w1" }],
      workPackages: [wp("wp1", "F-02", "ฐานราก", "W01")],
    });
    expect(r.teams[0]?.workPackages).toEqual([
      { id: "wp1", code: "F-02", name: "ฐานราก", categoryCode: "W01" },
    ]);
  });

  it("dedupes and orders a crew's งาน by code", () => {
    const r = build({
      workers: [w("w1", "A"), w("w2", "B")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      members: [
        { crew_id: "c1", worker_id: "w1" },
        { crew_id: "c1", worker_id: "w2" },
      ],
      // w1 on S-01 and F-02; w2 also on F-02 → F-02 appears once, sorted before S-01.
      planItems: [
        { id: "i1", work_package_id: "wpS" },
        { id: "i2", work_package_id: "wpF" },
      ],
      planCrew: [
        { item_id: "i1", worker_id: "w1" },
        { item_id: "i2", worker_id: "w1" },
        { item_id: "i2", worker_id: "w2" },
      ],
      workPackages: [wp("wpS", "S-01", "เสาเอ็น"), wp("wpF", "F-02", "ฐานราก")],
    });
    expect(r.teams[0]?.workPackages?.map((x) => x.code)).toEqual(["F-02", "S-01"]);
  });

  it("counts the งาน the crew LEAD is planned on, not only members", () => {
    const r = build({
      workers: [w("lead1", "หัวหน้า")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: "lead1" }],
      members: [],
      planItems: [{ id: "i1", work_package_id: "wp1" }],
      planCrew: [{ item_id: "i1", worker_id: "lead1" }],
      workPackages: [wp("wp1", "W-03", "ผนัง")],
    });
    expect(r.teams[0]?.workPackages?.map((x) => x.code)).toEqual(["W-03"]);
  });

  it("gives a crew with no planned งาน an empty workPackages list", () => {
    const r = build({
      workers: [w("w1", "A")],
      crews: [{ id: "c1", name: "ทีม A", lead_worker_id: null }],
      members: [{ crew_id: "c1", worker_id: "w1" }],
    });
    expect(r.teams[0]?.workPackages).toEqual([]);
  });
});
