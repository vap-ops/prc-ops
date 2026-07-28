// Spec 368 U4 — the store section's split: อยู่ในคลัง vs ยืมไปที่งาน.
//
// "Out" is derived from OPEN USAGE LOGS (the caller supplies rows already
// filtered by the check_out anti-join) — never from equipment_items.status,
// which movements clobber mid-loan (368 §6.1). Bulk rows are pinned to the
// in-store group whatever the logs say (370 D5: bulk never borrows in v1 —
// a rogue log must not make the shelf lie). A loan whose item is missing from
// the store list still renders in the out group: a mis-shelved or re-deployed
// tool with an open span is exactly the obligation this view exists to show.

import { loanDays } from "./wp-loans";

export interface StoreSplitItem {
  id: string;
  name: string;
  categoryName: string;
  assetTag: string | null;
  status: string;
  condition: string | null;
  tracking: "unit" | "bulk";
  quantity: number | null;
}

export interface StoreOpenLoan {
  logId: string;
  itemId: string;
  wpId: string;
  wpCode: string;
  wpName: string;
  checkedOutOn: string;
  holderName: string;
}

export interface StoreOutRow extends StoreOpenLoan {
  itemName: string;
  days: number;
}

export function splitStoreEquipment(input: {
  items: readonly StoreSplitItem[];
  openLoans: readonly StoreOpenLoan[];
  /** ISO date (yyyy-mm-dd, Bangkok). */
  today: string;
}): {
  out: StoreOutRow[];
  inStore: StoreSplitItem[];
  counts: { inStore: number; out: number };
} {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const out: StoreOutRow[] = input.openLoans
    .filter((l) => byId.get(l.itemId)?.tracking !== "bulk")
    .map((l) => ({
      ...l,
      itemName: byId.get(l.itemId)?.name ?? l.itemId,
      days: loanDays(l.checkedOutOn, input.today),
    }))
    .sort((a, b) => a.checkedOutOn.localeCompare(b.checkedOutOn));
  const outItemIds = new Set(out.map((r) => r.itemId));
  const inStore = input.items.filter((i) => !outItemIds.has(i.id));
  return { out, inStore, counts: { inStore: inStore.length, out: out.length } };
}
