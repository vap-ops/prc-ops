// Spec 46 P1 — roster grouping for the capture picker: own techs
// first, then DC workers grouped by contractor name.

import { describe, it, expect } from "vitest";
import { groupRoster, type RosterWorker } from "@/lib/labor/group-workers";

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
