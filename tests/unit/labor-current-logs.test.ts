// Spec 46 P1 — current-state filter for labor_logs (supersede pattern,
// ADR 0009 anti-join semantics in the app layer + ADR 0015 tombstone
// filter; current-photos.ts lineage).

import { describe, it, expect } from "vitest";
import { currentLaborLogs, type LaborLogRow } from "@/lib/labor/current-logs";

function row(overrides: Partial<LaborLogRow>): LaborLogRow {
  return {
    id: "r1",
    work_package_id: "wp1",
    worker_id: "w1",
    work_date: "2026-06-10",
    day_fraction: "full",
    worker_name_snapshot: "Worker",
    worker_type_snapshot: "own",
    contractor_id_snapshot: null,
    entered_by: "u1",
    self_logged: false,
    superseded_by: null,
    correction_reason: null,
    created_at: "2026-06-10T08:00:00Z",
    note: null,
    ...overrides,
  };
}

describe("currentLaborLogs", () => {
  it("keeps a plain entry", () => {
    expect(currentLaborLogs([row({})]).map((r) => r.id)).toEqual(["r1"]);
  });

  it("drops a superseded entry, keeps its correction", () => {
    const rows = [
      row({ id: "orig" }),
      row({ id: "corr", day_fraction: "half", superseded_by: "orig", correction_reason: "แก้" }),
    ];
    expect(currentLaborLogs(rows).map((r) => r.id)).toEqual(["corr"]);
  });

  it("drops tombstoned entries entirely", () => {
    const rows = [
      row({ id: "orig" }),
      row({ id: "tomb", day_fraction: null, superseded_by: "orig", correction_reason: "ลบ" }),
    ];
    expect(currentLaborLogs(rows)).toEqual([]);
  });

  it("keeps a re-log after a tombstone", () => {
    const rows = [
      row({ id: "orig" }),
      row({ id: "tomb", day_fraction: null, superseded_by: "orig", correction_reason: "ลบ" }),
      row({ id: "again", day_fraction: "half" }),
    ];
    expect(currentLaborLogs(rows).map((r) => r.id)).toEqual(["again"]);
  });

  it("follows a correction chain to the newest row", () => {
    const rows = [
      row({ id: "v1" }),
      row({ id: "v2", superseded_by: "v1", correction_reason: "แก้1", day_fraction: "half" }),
      row({ id: "v3", superseded_by: "v2", correction_reason: "แก้2", day_fraction: "full" }),
    ];
    expect(currentLaborLogs(rows).map((r) => r.id)).toEqual(["v3"]);
  });
});
