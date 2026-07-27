// Spec 363 U4 (D5) — "the shelf picks the path".
//
// The SA's state is "I need ปูน". Withdraw-vs-request-vs-self-buy is the firm's
// LEDGER taxonomy — a distinction procurement and accounting need, not one the
// person on site should have to make before they can ask for cement. The app
// already knows what is on the shelf, so `ต้องการของ` asks for the ITEM and this
// decides which action leads.
//
// ซื้อมาเองแล้ว is PERMANENTLY secondary. It records money that has ALREADY left
// the company, so its position states the firm's order of preference — store
// first ([[store-first-material-flow-doctrine]]) — without ever blocking it.
// That is a stronger reading of the operator's "เบิก first" than a default chip:
// store-first becomes the path of least resistance rather than a default the SA
// has to notice and not override.

export const NEED_PATHS = ["issue", "request", "self"] as const;
export type NeedPath = (typeof NEED_PATHS)[number];

export interface NeedDecision {
  primary: NeedPath;
  secondary: NeedPath[];
}

/**
 * @param qtyOnHand the project store's on-hand for the chosen item. `null` means
 *   the store has no row for it at all — an item it has never carried.
 */
export function decideNeedPath(qtyOnHand: number | null): NeedDecision {
  // `null` (never stocked) and a non-positive figure both mean "there is nothing
  // to withdraw". Leading with เบิก in either case would send the SA to a form
  // that cannot succeed — and a ledger CAN go negative, so `> 0` rather than
  // `!== 0`.
  const hasStock = qtyOnHand !== null && qtyOnHand > 0;

  return hasStock
    ? // เบิก leads, but ขอซื้อ stays offered: on-hand is a ledger figure and the
      // physical shelf can disagree with it. The SA must be able to request
      // anyway without backing out of the sheet.
      { primary: "issue", secondary: ["request", "self"] }
    : // Nothing to withdraw, so เบิก is not offered at all rather than offered
      // and refused on submit.
      { primary: "request", secondary: ["self"] };
}
