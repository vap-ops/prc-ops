// Spec 330 U6 — pure grouping of a day's plan items onto the team map.
// The daily plan stores per-item WORKER sets (ADR 0076 — no team FK), so the
// map derives team chips by overlap with each crew's member set:
//   * zero workers            → tray (planned-but-unassigned; safe to place)
//   * overlap with a crew     → chip on that card; `mixed` when the item's
//     workers are NOT a subset of the team (an SA hand-tuned it on /sa/plan —
//     team-grain writes are locked out so the map can never clobber it)
//   * workers but no overlap  → `individual` (visible, read-only: the SA
//     planned pool/other workers person-by-person)
// Firm and pool cards NEVER receive chips — the plan's money chain
// (mark-present → log_labor_day) is PRC-crew-only (spec 328 §2.4).
import { describe, expect, it } from "vitest";

import { buildDayAssignments, type DayPlanWpItem } from "@/lib/work-plans/day-assignments";
import type { TeamMapTeamCard } from "@/lib/team-map/build-team-map";

const item = (id: string, workerIds: string[]): DayPlanWpItem => ({
  itemId: id,
  workPackageId: `wp-${id}`,
  code: `WP-${id}`,
  name: `งาน ${id}`,
  workerIds,
});

const TEAMS: TeamMapTeamCard[] = [
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
    kind: "firm",
    id: "firm-1",
    name: "ทีมช่างอวย",
    members: [{ workerId: "f1", name: "อวย", isTeamLead: false, contractorId: "firm-1" }],
    count: 1,
  },
  {
    kind: "unassigned",
    id: "unassigned",
    name: "ยังไม่จัดทีม",
    members: [{ workerId: "p1", name: "ห้า", isTeamLead: false, contractorId: null }],
    count: 1,
  },
];

describe("buildDayAssignments (spec 330 U6)", () => {
  it("routes crewless items to the tray", () => {
    const r = buildDayAssignments([item("t1", []), item("t2", [])], TEAMS);
    expect(r.tray.map((i) => i.itemId)).toEqual(["t1", "t2"]);
    expect(r.byTeam.size).toBe(0);
    expect(r.individual).toEqual([]);
  });

  it("a subset item lands on its team, not mixed", () => {
    const r = buildDayAssignments([item("s1", ["a1", "a2"]), item("s2", ["a1"])], TEAMS);
    expect(r.tray).toEqual([]);
    const onA = r.byTeam.get("cr-a") ?? [];
    expect(onA.map((e) => e.item.itemId)).toEqual(["s1", "s2"]);
    expect(onA.every((e) => !e.mixed)).toBe(true);
  });

  it("an item spanning two crews shows on BOTH cards as mixed", () => {
    const r = buildDayAssignments([item("m1", ["a1", "b1"])], TEAMS);
    expect(r.byTeam.get("cr-a")?.[0]).toMatchObject({ mixed: true });
    expect(r.byTeam.get("cr-b")?.[0]).toMatchObject({ mixed: true });
  });

  it("extra non-team workers make an item mixed even on its main team", () => {
    const r = buildDayAssignments([item("m2", ["a1", "a2", "p1"])], TEAMS);
    expect(r.byTeam.get("cr-a")?.[0]).toMatchObject({ mixed: true });
  });

  it("firm and pool cards never receive chips; pool-only items are individual", () => {
    const r = buildDayAssignments([item("f1x", ["f1"]), item("p1x", ["p1"])], TEAMS);
    expect(r.byTeam.has("firm-1")).toBe(false);
    expect(r.byTeam.has("unassigned")).toBe(false);
    expect(r.individual.map((i) => i.itemId)).toEqual(["f1x", "p1x"]);
  });

  it("keeps item order stable within a team (plan sort order)", () => {
    const r = buildDayAssignments([item("o2", ["a2"]), item("o1", ["a1"])], TEAMS);
    expect((r.byTeam.get("cr-a") ?? []).map((e) => e.item.itemId)).toEqual(["o2", "o1"]);
  });
});
