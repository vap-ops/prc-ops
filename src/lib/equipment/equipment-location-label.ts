// Spec 141 U4 — the "where is it" badge string for an equipment item. Takes the
// U3-derived EquipmentLocation (latest movement per item; undefined when the item
// has no movements yet) and the resolved project name, and composes the SSOT
// EQUIPMENT_MOVEMENT_KIND_LABEL. Only 'deployed' carries a project (the DB CHECK
// guarantees project_id is set IFF kind='deployed'), so only it appends the name.

import { EQUIPMENT_MOVEMENT_KIND_LABEL } from "@/lib/i18n/labels";
import type { EquipmentLocation } from "@/lib/equipment/current-location";

const NO_MOVEMENT_PLACEHOLDER = "—";

export function equipmentLocationLabel(
  location: EquipmentLocation | undefined,
  projectName: string | null,
): string {
  if (!location) return NO_MOVEMENT_PLACEHOLDER;
  const kindLabel = EQUIPMENT_MOVEMENT_KIND_LABEL[location.kind];
  if (location.kind === "deployed" && projectName) {
    return `${kindLabel}: ${projectName}`;
  }
  return kindLabel;
}
