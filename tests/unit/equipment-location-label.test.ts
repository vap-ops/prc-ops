// Writing failing test first.
//
// Spec 141 U4 — equipmentLocationLabel turns the U3-derived EquipmentLocation
// (latest movement per item: received / deployed→project / returned /
// maintenance / lost) into the Thai "where is it" badge string. It composes the
// SSOT EQUIPMENT_MOVEMENT_KIND_LABELS (i18n/labels.ts) with the project name for
// a deployed item, and returns a placeholder when an item has no movements.

import { describe, it, expect } from "vitest";
import { equipmentLocationLabel } from "@/lib/equipment/equipment-location-label";
import type { EquipmentLocation } from "@/lib/equipment/current-location";

function loc(kind: EquipmentLocation["kind"], projectId: string | null): EquipmentLocation {
  return { kind, projectId };
}

describe("equipmentLocationLabel", () => {
  it("shows the project name for a deployed item", () => {
    expect(equipmentLocationLabel(loc("deployed", "p1"), "บ้านคุณเอ")).toBe("หน้างาน: บ้านคุณเอ");
  });

  it("falls back to the bare deployed label when the project name is missing", () => {
    expect(equipmentLocationLabel(loc("deployed", "p1"), null)).toBe("หน้างาน");
  });

  it("labels received as back in the warehouse", () => {
    expect(equipmentLocationLabel(loc("received", null), null)).toBe("รับเข้าคลัง");
  });

  it("labels returned as back with the owner", () => {
    expect(equipmentLocationLabel(loc("returned", null), null)).toBe("คืนเจ้าของ");
  });

  it("labels maintenance", () => {
    expect(equipmentLocationLabel(loc("maintenance", null), null)).toBe("ซ่อมบำรุง");
  });

  it("labels lost", () => {
    expect(equipmentLocationLabel(loc("lost", null), null)).toBe("สูญหาย");
  });

  it("returns a placeholder when the item has no movements", () => {
    expect(equipmentLocationLabel(undefined, null)).toBe("—");
  });
});
