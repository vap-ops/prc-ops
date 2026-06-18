// Writing failing test first.
//
// Spec 141 U3 — current equipment location is DERIVED from the append-only
// equipment_movements event log: the latest movement per item wins (received /
// deployed→project / returned / maintenance / lost). Not a supersede chain —
// corrections are compensating events (ADR 0055 §4).

import { describe, it, expect } from "vitest";
import {
  currentEquipmentLocation,
  type EquipmentMovementRecord,
} from "@/lib/equipment/current-location";

function mv(
  itemId: string,
  kind: EquipmentMovementRecord["kind"],
  projectId: string | null,
  occurredAt: string,
): EquipmentMovementRecord {
  return { itemId, kind, projectId, occurredAt };
}

describe("currentEquipmentLocation", () => {
  it("returns the latest movement per item", () => {
    const loc = currentEquipmentLocation([
      mv("e1", "received", null, "2026-07-01T00:00:00Z"),
      mv("e1", "deployed", "p1", "2026-07-05T00:00:00Z"),
    ]);
    expect(loc.get("e1")).toEqual({ kind: "deployed", projectId: "p1" });
  });

  it("a return after a deploy clears the project (back with the owner)", () => {
    const loc = currentEquipmentLocation([
      mv("e1", "deployed", "p1", "2026-07-05T00:00:00Z"),
      mv("e1", "returned", null, "2026-07-09T00:00:00Z"),
    ]);
    expect(loc.get("e1")).toEqual({ kind: "returned", projectId: null });
  });

  it("tracks items independently", () => {
    const loc = currentEquipmentLocation([
      mv("e1", "deployed", "p1", "2026-07-05T00:00:00Z"),
      mv("e2", "maintenance", null, "2026-07-06T00:00:00Z"),
    ]);
    expect(loc.get("e1")?.kind).toBe("deployed");
    expect(loc.get("e2")?.kind).toBe("maintenance");
  });

  it("uses the latest occurredAt, not the array order", () => {
    const loc = currentEquipmentLocation([
      mv("e1", "deployed", "p1", "2026-07-05T00:00:00Z"),
      mv("e1", "received", null, "2026-07-01T00:00:00Z"), // earlier, listed last
    ]);
    expect(loc.get("e1")).toEqual({ kind: "deployed", projectId: "p1" });
  });

  it("returns an empty map for no movements", () => {
    expect(currentEquipmentLocation([]).size).toBe(0);
  });
});
