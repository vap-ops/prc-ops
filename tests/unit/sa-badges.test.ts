// Spec 306 U1 — badge card builder. Pure shaping: RLS-read workers + the
// service-role employee_id map + project list → per-project badge groups,
// name-ordered, with a null code when the PRC code is missing (badge still
// prints — the QR carries the worker id; the code is the human fallback).
import { describe, expect, it } from "vitest";

import { buildBadgeGroups } from "@/lib/sa/badges";

const projects = [
  { id: "p1", code: "PRC-2026-004", name: "TFM โพธิ์ทอง" },
  { id: "p2", code: "PRC-2026-005", name: "อาคาร B" },
];

const workers = [
  { id: "w2", name: "สมศักดิ์", project_id: "p1" },
  { id: "w1", name: "สมชาย", project_id: "p1" },
  { id: "w3", name: "วิรัช", project_id: "p2" },
  { id: "w4", name: "ไม่มีโปรเจกต์", project_id: null },
];

const codes = new Map([
  ["w1", "PRC-26-0002"],
  ["w2", "PRC-26-0006"],
]);

describe("buildBadgeGroups", () => {
  it("groups workers by project in the given project order, workers name-ordered", () => {
    const groups = buildBadgeGroups(workers, codes, projects);
    expect(groups.map((g) => g.project.id)).toEqual(["p1", "p2"]);
    expect(groups[0]?.badges.map((b) => b.name)).toEqual(["สมชาย", "สมศักดิ์"]);
    expect(groups[0]?.badges.map((b) => b.workerId)).toEqual(["w1", "w2"]);
  });

  it("attaches the PRC code from the map, null when absent", () => {
    const groups = buildBadgeGroups(workers, codes, projects);
    expect(groups[0]?.badges[0]?.code).toBe("PRC-26-0002");
    expect(groups[1]?.badges[0]?.code).toBeNull();
  });

  it("drops projects with no workers and workers with no project", () => {
    const groups = buildBadgeGroups(workers, codes, [
      ...projects,
      { id: "p3", code: "PRC-2026-006", name: "ว่าง" },
    ]);
    expect(groups.map((g) => g.project.id)).toEqual(["p1", "p2"]);
    const allIds = groups.flatMap((g) => g.badges.map((b) => b.workerId));
    expect(allIds).not.toContain("w4");
  });

  it("filters to a single worker when workerId is given (single reprint)", () => {
    const groups = buildBadgeGroups(workers, codes, projects, "w2");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.badges.map((b) => b.workerId)).toEqual(["w2"]);
  });
});
