// Spec 367 U1 — the equipment label maps move into the labels.ts SSOT.
//
// Why this test exists: before this unit the status map and the unit/bulk
// tracking options were LOCAL consts inside equipment-manager.tsx (a component),
// while their siblings EQUIPMENT_MOVEMENT_KIND_LABEL and
// EQUIPMENT_RATE_PERIOD_LABEL already lived in labels.ts. The spec 367 §6
// importer has to map a Thai column value back to an enum value and cannot
// import from a component, so the split had to close before U3 could be built.
//
// Each map is asserted EXHAUSTIVE over the COMPLETE generated enum domain
// rather than against a hand-typed list — a hand-list silently misses the next
// enum value, which is exactly how `disposed` would have slipped through with a
// blank label.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_CONDITION_LABEL,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_TRACKING_LABEL,
} from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

const nonEmptyThai = (v: string) => v.trim().length > 0;

describe("equipment label SSOT (spec 367 U1)", () => {
  it("EQUIPMENT_STATUS_LABEL covers every equipment_status value, including disposed", () => {
    const keys = Object.keys(EQUIPMENT_STATUS_LABEL).sort();
    expect(keys).toEqual(
      ["available", "on_site", "in_use", "maintenance", "returned", "lost", "disposed"].sort(),
    );
    expect(Object.values(EQUIPMENT_STATUS_LABEL).every(nonEmptyThai)).toBe(true);
  });

  it("EQUIPMENT_CONDITION_LABEL covers every equipment_condition grade", () => {
    const keys = Object.keys(EQUIPMENT_CONDITION_LABEL).sort();
    expect(keys).toEqual(["new", "good", "fair", "needs_repair"].sort());
    expect(Object.values(EQUIPMENT_CONDITION_LABEL).every(nonEmptyThai)).toBe(true);
  });

  it("EQUIPMENT_TRACKING_LABEL covers unit and bulk", () => {
    expect(Object.keys(EQUIPMENT_TRACKING_LABEL).sort()).toEqual(["bulk", "unit"]);
    expect(Object.values(EQUIPMENT_TRACKING_LABEL).every(nonEmptyThai)).toBe(true);
  });

  // The importer's contract is label → enum. That inversion is only sound if no
  // two enum values share a label; a duplicate would make one of them
  // unreachable from a spreadsheet, silently, for whichever came second.
  it("labels are UNIQUE within each map (the importer inverts them)", () => {
    for (const [name, map] of [
      ["status", EQUIPMENT_STATUS_LABEL],
      ["condition", EQUIPMENT_CONDITION_LABEL],
      ["tracking", EQUIPMENT_TRACKING_LABEL],
    ] as const) {
      const values = Object.values(map);
      expect(new Set(values).size, `${name} has a duplicate label`).toBe(values.length);
    }
  });

  // Type-level guard: these must be Records over the GENERATED enums, so that
  // adding a value to the Postgres enum and regenerating types reds the build
  // instead of shipping a missing label. Assigning them to the strict Record
  // type is what enforces it — the runtime assertion is incidental.
  it("is typed against the generated enums, not a hand-written union", () => {
    const status: Record<Enums["equipment_status"], string> = EQUIPMENT_STATUS_LABEL;
    const condition: Record<Enums["equipment_condition"], string> = EQUIPMENT_CONDITION_LABEL;
    const tracking: Record<Enums["equipment_tracking"], string> = EQUIPMENT_TRACKING_LABEL;
    expect(status.disposed).toBeTruthy();
    expect(condition.needs_repair).toBeTruthy();
    expect(tracking.bulk).toBeTruthy();
  });
});
