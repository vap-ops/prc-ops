// Spec 141 U3 — derive current equipment location from the append-only
// equipment_movements event log. Current state = the latest movement per item
// (by occurredAt). Movements are immutable events, not a supersede chain: a
// correction is a new compensating event (ADR 0055 §4). The kind union is kept
// local (not imported from the generated DB enum) so this pure helper compiles
// before db:types regenerates after the U3 migration ships.
//
// Bulk note: this returns the latest EVENT per item; partial bulk quantities
// split across projects are an allocation/P2 concern (U1 seam), not derived here.

export type EquipmentMovementKind = "received" | "deployed" | "returned" | "maintenance" | "lost";

export interface EquipmentMovementRecord {
  itemId: string;
  kind: EquipmentMovementKind;
  projectId: string | null;
  /** ISO-8601 timestamp; latest wins. */
  occurredAt: string;
}

export interface EquipmentLocation {
  kind: EquipmentMovementKind;
  projectId: string | null;
}

export function currentEquipmentLocation(
  movements: EquipmentMovementRecord[],
): Map<string, EquipmentLocation> {
  const latest = new Map<string, EquipmentMovementRecord>();
  for (const m of movements) {
    const prev = latest.get(m.itemId);
    if (!prev || m.occurredAt > prev.occurredAt) latest.set(m.itemId, m);
  }
  const out = new Map<string, EquipmentLocation>();
  for (const [itemId, m] of latest) {
    out.set(itemId, { kind: m.kind, projectId: m.projectId });
  }
  return out;
}
