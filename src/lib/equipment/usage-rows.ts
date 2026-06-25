// Spec 202 U2 — pure derivation for the WP อุปกรณ์ tab. equipment_usage_logs is
// append-only + supersede (spec 146 U3): a check-in inserts a CLOSED successor
// whose superseded_by points at the OPEN row it closes. Current state is the
// anti-join (a row NOT pointed at by any newer row's superseded_by), exactly like
// current-location.ts / the labor current-logs helper. No money here — the
// daily_rate_snapshot column is never read into this shape.

export type EquipmentUsageRow = {
  id: string;
  item_id: string;
  checked_out_on: string;
  checked_in_on: string | null;
  superseded_by: string | null;
};

export type EquipmentUsageDisplay = {
  id: string;
  itemId: string;
  checkedOutOn: string;
  checkedInOn: string | null;
};

function toDisplay(r: EquipmentUsageRow): EquipmentUsageDisplay {
  return {
    id: r.id,
    itemId: r.item_id,
    checkedOutOn: r.checked_out_on,
    checkedInOn: r.checked_in_on,
  };
}

export function splitEquipmentUsage(rows: EquipmentUsageRow[]): {
  open: EquipmentUsageDisplay[];
  history: EquipmentUsageDisplay[];
} {
  // Anti-join: a row superseded by a newer row is not current.
  const superseded = new Set(rows.map((r) => r.superseded_by).filter((id): id is string => !!id));
  const current = rows.filter((r) => !superseded.has(r.id));

  const open = current
    .filter((r) => r.checked_in_on === null)
    // Oldest checkout first — the gear that's been out longest sits at the top.
    .sort((a, b) => a.checked_out_on.localeCompare(b.checked_out_on))
    .map(toDisplay);

  const history = current
    .filter((r) => r.checked_in_on !== null)
    // Most recent checkout first.
    .sort((a, b) => b.checked_out_on.localeCompare(a.checked_out_on))
    .map(toDisplay);

  return { open, history };
}
