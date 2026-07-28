// Spec 363 U7 — pure shapers for the WP ของ-tab เครื่องมือ section.
//
// An open loan is an OBLIGATION WITH A CLOCK (spec 363 D5): the section lists
// this WP's open spans oldest-obligation-visible (newest first like the sibling
// groups, the clock text carrying the age), and offers ยืมเครื่องมือ over the
// units actually borrowable here.
//
// "Who has it" = borrower_worker_id when the recording door captured one, else
// the RECORDER — entered_by is always the scanning custodian under spec 370 D1,
// so alone it cannot answer the question (fact-check F5).

import { currentEquipmentLocation, type EquipmentMovementRecord } from "./current-location";

export interface WpLoanLogRow {
  id: string;
  itemId: string;
  workPackageId: string;
  /** ISO date (yyyy-mm-dd). */
  checkedOutOn: string;
  borrowerWorkerId: string | null;
  enteredBy: string;
}

export interface WpLoanRow {
  logId: string;
  itemId: string;
  itemName: string;
  holderName: string;
  checkedOutOn: string;
  days: number;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two ISO dates (0 = same day → "ยืมวันนี้"). */
export function loanDays(checkedOutOn: string, today: string): number {
  const out = Date.parse(`${checkedOutOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(out) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.round((now - out) / MS_PER_DAY));
}

export function shapeWpLoans(
  logs: readonly WpLoanLogRow[],
  ctx: {
    items: ReadonlyMap<string, string>;
    workers: ReadonlyMap<string, string>;
    users: ReadonlyMap<string, string>;
    wpId: string;
    /** ISO date (yyyy-mm-dd). */
    today: string;
  },
): WpLoanRow[] {
  return logs
    .filter((l) => l.workPackageId === ctx.wpId)
    .map((l) => ({
      logId: l.id,
      itemId: l.itemId,
      // A registry miss must not hide an open obligation — fall back to the id.
      itemName: ctx.items.get(l.itemId) ?? l.itemId,
      holderName:
        (l.borrowerWorkerId ? ctx.workers.get(l.borrowerWorkerId) : undefined) ??
        ctx.users.get(l.enteredBy) ??
        "—",
      checkedOutOn: l.checkedOutOn,
      days: loanDays(l.checkedOutOn, ctx.today),
    }))
    .sort((a, b) => b.checkedOutOn.localeCompare(a.checkedOutOn));
}

export interface BorrowableItem {
  id: string;
  name: string;
  tracking: "unit" | "bulk";
}

/**
 * Unit-tracked items currently AT this project (latest movement = deployed
 * here), minus items already out on ANY open loan — the client-side mirror of
 * the RPC's one-open-span guard, so the picker never offers a row the RPC will
 * refuse (the offer-then-refuse rule). Bulk rows are excluded by 370 D5.
 */
export function availableToBorrow(input: {
  items: readonly BorrowableItem[];
  movements: EquipmentMovementRecord[];
  projectId: string;
  openLoanItemIds: ReadonlySet<string>;
}): BorrowableItem[] {
  const here = new Set<string>();
  for (const [itemId, loc] of currentEquipmentLocation(input.movements)) {
    if (loc.kind === "deployed" && loc.projectId === input.projectId) here.add(itemId);
  }
  return input.items.filter(
    (i) => i.tracking === "unit" && here.has(i.id) && !input.openLoanItemIds.has(i.id),
  );
}
