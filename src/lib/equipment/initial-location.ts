// Spec 367 Q1 — resolve the add sheet's "ตอนนี้อยู่ที่ไหน" answer into the
// initial `equipment_movements` row.
//
// Location on /equipment is derived PURELY from the latest movement per item
// (`current-location.ts` → `equipment-location-label.ts`). The add flow wrote no
// movement, so a freshly registered item rendered `—` — 63 of 64 items carried
// that blank before the 2026-07-30 reset, and it was fixed by a scripted
// backfill rather than by the form. Spec 367 §Q1 asked whether the LABEL should
// default to "at คลัง" instead; recording a real event is the honest answer, and
// it costs the registrar nothing because the picker is already prefilled.
//
// The return shape mirrors the DB CHECK `(project_id IS NOT NULL) = (kind =
// 'deployed')`, so a caller cannot assemble a row the constraint would reject —
// a 23514 here would land AFTER the item row was already written.

import { UUID_REGEX } from "@/lib/validate/uuid";

/** The picker's non-project option. A uuid can never collide with it. */
export const STORE_LOCATION = "store";

export interface InitialMovement {
  kind: "received" | "deployed";
  projectId: string | null;
  quantity: number;
}

export type InitialMovementResult =
  { ok: true; value: InitialMovement } | { ok: false; error: string };

export const UNPICKED_LOCATION_ERROR = "กรุณาเลือกว่าตอนนี้อุปกรณ์อยู่ที่ไหน";

/**
 * Is this picker value one the resolver can use? Exported so the action can
 * refuse an unpicked location BEFORE its first write — on the new-SKU escape the
 * catalog row is inserted before the instance is validated, so a late refusal
 * would leave a registered SKU behind with no unit under it. One rule, two call
 * sites: the resolver below reads the same predicate rather than restating it.
 */
export function isKnownLocation(location: string): boolean {
  return location === STORE_LOCATION || UUID_REGEX.test(location);
}

export function resolveInitialMovement(input: {
  location: string;
  tracking: "unit" | "bulk";
  /** The item's own quantity — already validated by validateEquipmentItem. */
  quantity: number | null;
}): InitialMovementResult {
  // Covers both the unpicked sentinel and anything crafted: the registrar's fix
  // is the same in either case — say where it is.
  if (!isKnownLocation(input.location)) {
    return { ok: false, error: UNPICKED_LOCATION_ERROR };
  }

  // A bulk registration moves its WHOLE count, not one of them; a unit item is
  // one thing. The DB CHECK demands >= 1 either way, so a bulk row that reached
  // here without a usable count is refused rather than sent to fail as 23514.
  let quantity = 1;
  if (input.tracking === "bulk") {
    if (!Number.isInteger(input.quantity) || (input.quantity as number) < 1) {
      return { ok: false, error: "จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1" };
    }
    quantity = input.quantity as number;
  }

  return input.location === STORE_LOCATION
    ? { ok: true, value: { kind: "received", projectId: null, quantity } }
    : { ok: true, value: { kind: "deployed", projectId: input.location, quantity } };
}
