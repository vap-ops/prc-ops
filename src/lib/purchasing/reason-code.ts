// Spec 176 U4 — the reactive-PR reason code. Every purchase request (the
// scramble order relative to the frozen supply plan) carries one, saying WHY
// the item wasn't simply drawn from the plan/store. Only `unplanned_miss`
// counts against the PM's planning accuracy (the scoring rule lives in U5);
// the rest are fair reactive reasons.
//
// Single source for the type + runtime list + guard — the create / site
// validators and both forms iterate / check against this; the Thai labels
// live in src/lib/i18n/labels.ts. Declaration order is the canonical UI order
// and is pinned by the unit test + the pgTAP enum_has_labels assertion.

export type PurchaseReasonCode =
  | "unplanned_miss"
  | "rework"
  | "breakage"
  | "scope_change"
  | "unforeseeable";

export const PURCHASE_REASON_CODES: ReadonlyArray<PurchaseReasonCode> = [
  "unplanned_miss",
  "rework",
  "breakage",
  "scope_change",
  "unforeseeable",
];

export function isPurchaseReasonCode(value: unknown): value is PurchaseReasonCode {
  return typeof value === "string" && (PURCHASE_REASON_CODES as readonly string[]).includes(value);
}
