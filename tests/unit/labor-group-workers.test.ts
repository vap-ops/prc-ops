// Spec 46 P1 — roster grouping for the capture picker: own techs
// first, then DC workers grouped by contractor name.

import { describe, it, expect } from "vitest";
import {
  groupRoster,
  filterRoster,
  partitionRosterByProject,
  type RosterWorker,
} from "@/lib/labor/group-workers";

const CONTRACTORS = [
  { id: "c1", name: "DC Crew A" },
  { id: "c2", name: "DC Crew B" },
];

function worker(overrides: Partial<RosterWorker>): RosterWorker {
  return {
    id: "w",
    name: "Worker",
    worker_type: "own",
    contractor_id: null,
    active: true,
    ...overrides,
  };
}

describe("groupRoster", () => {
  it("splits own and dc, dc grouped by contractor with names resolved", () => {
    const grouped = groupRoster(
      [
        worker({ id: "w1", name: "Tech One" }),
        worker({ id: "w2", name: "DC One", worker_type: "dc", contractor_id: "c1" }),
        worker({ id: "w3", name: "DC Two", worker_type: "dc", contractor_id: "c2" }),
        worker({ id: "w4", name: "DC Three", worker_type: "dc", contractor_id: "c1" }),
      ],
      CONTRACTORS,
    );
    expect(grouped.own.map((w) => w.id)).toEqual(["w1"]);
    expect(grouped.dc.map((g) => g.contractorName)).toEqual(["DC Crew A", "DC Crew B"]);
    expect(grouped.dc[0]?.workers.map((w) => w.id)).toEqual(["w2", "w4"]);
  });

  it("excludes inactive workers", () => {
    const grouped = groupRoster(
      [worker({ id: "w1", active: false }), worker({ id: "w2" })],
      CONTRACTORS,
    );
    expect(grouped.own.map((w) => w.id)).toEqual(["w2"]);
  });

  it("falls back to a placeholder name for an unknown contractor", () => {
    const grouped = groupRoster(
      [worker({ id: "w1", worker_type: "dc", contractor_id: "missing" })],
      CONTRACTORS,
    );
    expect(grouped.dc[0]?.contractorName).toBeTruthy();
  });
});

describe("filterRoster (spec 158 U1)", () => {
  // A grouped roster: one own tech + two DC crews (Crew A has two workers).
  const grouped = groupRoster(
    [
      worker({ id: "w1", name: "ช่างสมชาย" }),
      worker({ id: "w2", name: "สมหญิง", worker_type: "dc", contractor_id: "c1" }),
      worker({ id: "w3", name: "Somsak", worker_type: "dc", contractor_id: "c1" }),
      worker({ id: "w4", name: "วิชัย", worker_type: "dc", contractor_id: "c2" }),
    ],
    CONTRACTORS,
  );

  it("returns the roster unchanged for an empty / whitespace query", () => {
    expect(filterRoster(grouped, "")).toEqual(grouped);
    expect(filterRoster(grouped, "   ")).toEqual(grouped);
  });

  it("keeps only workers whose name matches (substring, across groups)", () => {
    const r = filterRoster(grouped, "สม");
    // own ช่างสมชาย contains สม; DC สมหญิง contains สม; วิชัย + Somsak do not.
    expect(r.own.map((w) => w.id)).toEqual(["w1"]);
    expect(r.dc.flatMap((g) => g.workers.map((w) => w.id))).toEqual(["w2"]);
  });

  it("is case-insensitive for latin names", () => {
    const r = filterRoster(grouped, "somsak");
    expect(r.dc.flatMap((g) => g.workers.map((w) => w.id))).toEqual(["w3"]);
    expect(r.own).toEqual([]);
  });

  it("a contractor-name match keeps the whole group", () => {
    const r = filterRoster(grouped, "Crew A");
    expect(r.dc).toHaveLength(1);
    expect(r.dc[0]?.contractorName).toBe("DC Crew A");
    expect(r.dc[0]?.workers.map((w) => w.id)).toEqual(["w2", "w3"]);
    expect(r.own).toEqual([]);
  });

  it("drops groups left with no matching workers", () => {
    const r = filterRoster(grouped, "วิชัย");
    expect(r.dc.map((g) => g.contractorName)).toEqual(["DC Crew B"]);
    expect(r.dc[0]?.workers.map((w) => w.id)).toEqual(["w4"]);
  });
});

describe("partitionRosterByProject (spec 158 U2)", () => {
  // own w1 + Crew A (w2, w3) + Crew B (w4).
  const grouped = groupRoster(
    [
      worker({ id: "w1", name: "ช่างสมชาย" }),
      worker({ id: "w2", name: "สมหญิง", worker_type: "dc", contractor_id: "c1" }),
      worker({ id: "w3", name: "Somsak", worker_type: "dc", contractor_id: "c1" }),
      worker({ id: "w4", name: "วิชัย", worker_type: "dc", contractor_id: "c2" }),
    ],
    CONTRACTORS,
  );

  it("splits own and dc into in-project vs others by worker id", () => {
    // w1 (own) + w2 (Crew A) are on the project; w3 + w4 are not.
    const { inProject, others } = partitionRosterByProject(grouped, new Set(["w1", "w2"]));
    expect(inProject.own.map((w) => w.id)).toEqual(["w1"]);
    expect(inProject.dc.map((g) => g.contractorName)).toEqual(["DC Crew A"]);
    expect(inProject.dc[0]?.workers.map((w) => w.id)).toEqual(["w2"]);
    expect(others.own).toEqual([]);
    expect(others.dc.map((g) => g.contractorName)).toEqual(["DC Crew A", "DC Crew B"]);
    expect(others.dc[0]?.workers.map((w) => w.id)).toEqual(["w3"]);
    expect(others.dc[1]?.workers.map((w) => w.id)).toEqual(["w4"]);
  });

  it("an empty id set leaves in-project empty and others equal to the roster", () => {
    const { inProject, others } = partitionRosterByProject(grouped, new Set());
    expect(inProject).toEqual({ own: [], dc: [] });
    expect(others).toEqual(grouped);
  });

  it("preserves contractor group order and names within each partition", () => {
    const { inProject } = partitionRosterByProject(grouped, new Set(["w4", "w2"]));
    // Group order follows the roster (Crew A before Crew B), not the id-set order.
    expect(inProject.dc.map((g) => g.contractorName)).toEqual(["DC Crew A", "DC Crew B"]);
  });
});
