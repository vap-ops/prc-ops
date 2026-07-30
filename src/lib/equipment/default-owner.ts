// Operator ask 2026-07-30 — the ADD form preselects the fleet's default owner
// (PRI, Preston International Co., Ltd. at the time of writing).
//
// Read from `equipment_owners.is_default`, never from a name: spec 367 §3 is a
// sale-and-rent-back of the whole fleet, so the company that owns the plant is
// the thing most likely to change. A partial unique index keeps at most one row
// flagged, so "first match" is the only match.

export type OwnerOption = { id: string; name: string; isDefault?: boolean };

/**
 * The owner id the add form should start on. Returns `""` — the
 * "— เลือกเจ้าของ —" sentinel, which keeps the submit button disabled — when no
 * owner is flagged, so an unseeded database asks rather than guesses.
 */
export function pickDefaultOwnerId(owners: readonly OwnerOption[]): string {
  return owners.find((o) => o.isDefault === true)?.id ?? "";
}
