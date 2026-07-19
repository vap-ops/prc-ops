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
    pay_type: "monthly",
    contractor_id: null,
    active: true,
    ...overrides,
  };
}

describe("groupRoster", () => {
  it("splits own (monthly) and dc (daily, no firm) workers", () => {
    const grouped = groupRoster(
      [
        worker({ id: "w1", name: "Tech One" }),
        worker({ id: "w2", name: "DC One", pay_type: "daily" }),
        worker({ id: "w3", name: "DC Two", pay_type: "daily" }),
      ],
      CONTRACTORS,
    );
    expect(grouped.own.map((w) => w.id)).toEqual(["w1"]);
    expect(grouped.dc).toHaveLength(1);
    expect(grouped.dc[0]?.workers.map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("excludes inactive workers", () => {
    const grouped = groupRoster(
      [worker({ id: "w1", active: false }), worker({ id: "w2" })],
      CONTRACTORS,
    );
    expect(grouped.own.map((w) => w.id)).toEqual(["w2"]);
  });

  // Spec 328 U3 — the money wall, enforced at the picker: a contractor-tied
  // worker (workers.contractor_id NOT NULL ⇒ pay-exempt subcon member; their
  // labor cost lives inside the WP contract price) must NEVER surface in the
  // labor capture picker, else they could be ticked into labor_logs and appear
  // on payroll at gross 0.
  it("spec 328: excludes contractor-tied workers from the picker entirely", () => {
    const grouped = groupRoster(
      [
        worker({ id: "w1", name: "PRC Tech" }),
        worker({ id: "w2", name: "PRC Daily", pay_type: "daily" }),
        worker({ id: "w3", name: "Member Daily", pay_type: "daily", contractor_id: "c1" }),
        worker({ id: "w4", name: "Member Monthly", contractor_id: "c2" }),
      ],
      CONTRACTORS,
    );
    const allIds = [...grouped.own, ...grouped.dc.flatMap((g) => g.workers)].map((w) => w.id);
    expect(allIds).toEqual(["w1", "w2"]);
  });

  it("labels the no-firm daily group with the fallback placeholder", () => {
    const grouped = groupRoster([worker({ id: "w1", pay_type: "daily" })], CONTRACTORS);
    expect(grouped.dc[0]?.contractorName).toBeTruthy();
  });
});

// filterRoster / partitionRosterByProject operate on an already-built
// GroupedRoster — their grouping mechanics are independent of how groups
// formed, so the fixtures are literals (groupRoster itself now excludes
// contractor-tied workers per spec 328, see above).
function dcWorker(id: string, name: string, contractor_id: string): RosterWorker {
  return { id, name, pay_type: "daily", contractor_id, active: true };
}

describe("filterRoster (spec 158 U1)", () => {
  // A grouped roster: one own tech + two DC crews (Crew A has two workers).
  const grouped = {
    own: [worker({ id: "w1", name: "ช่างสมชาย" })],
    dc: [
      {
        contractorId: "c1",
        contractorName: "DC Crew A",
        workers: [dcWorker("w2", "สมหญิง", "c1"), dcWorker("w3", "Somsak", "c1")],
      },
      { contractorId: "c2", contractorName: "DC Crew B", workers: [dcWorker("w4", "วิชัย", "c2")] },
    ],
  };

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
  const grouped = {
    own: [worker({ id: "w1", name: "ช่างสมชาย" })],
    dc: [
      {
        contractorId: "c1",
        contractorName: "DC Crew A",
        workers: [dcWorker("w2", "สมหญิง", "c1"), dcWorker("w3", "Somsak", "c1")],
      },
      { contractorId: "c2", contractorName: "DC Crew B", workers: [dcWorker("w4", "วิชัย", "c2")] },
    ],
  };

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
