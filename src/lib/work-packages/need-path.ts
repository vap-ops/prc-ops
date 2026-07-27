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

import { isReadOnlyWpViewer } from "@/lib/auth/role-home";
import type { UserRole } from "@/lib/db/enums";

export const NEED_PATHS = ["issue", "request", "self"] as const;
export type NeedPath = (typeof NEED_PATHS)[number];

export interface NeedDecision {
  primary: NeedPath;
  secondary: NeedPath[];
}

/**
 * @param qtyOnHand the project store's on-hand for the chosen item. `null` means
 *   the store has no row for it at all — an item it has never carried.
 * @param allowed the paths this CALLER may take. Defaults to all three. Spec 363
 *   U4 merge: deleting the คำขอซื้อ tab makes this sheet the only PR door on the
 *   page, and plain `procurement` — a read-only WP viewer everywhere else — may
 *   raise a purchase request and nothing else (`isReadOnlyWpViewer`; the
 *   `purchase_requests` INSERT policy admits the role unconditionally). Gating
 *   the whole sheet would delete that capability; gating per PATH keeps it.
 */
export function decideNeedPath(
  qtyOnHand: number | null,
  allowed: readonly NeedPath[] = NEED_PATHS,
): NeedDecision {
  // `null` (never stocked) and a non-positive figure both mean "there is nothing
  // to withdraw". Leading with เบิก in either case would send the SA to a form
  // that cannot succeed — and a ledger CAN go negative, so `> 0` rather than
  // `!== 0`.
  const hasStock = qtyOnHand !== null && qtyOnHand > 0;

  // ORDER FIRST, filter second. Building the full preference order and then
  // dropping what the caller may not take means a restriction can only ever
  // REMOVE an option — it can never reorder the remaining ones, so store-first
  // survives whoever is looking.
  const ordered: NeedPath[] = hasStock
    ? // เบิก leads, but ขอซื้อ stays offered: on-hand is a ledger figure and the
      // physical shelf can disagree with it. The SA must be able to request
      // anyway without backing out of the sheet.
      ["issue", "request", "self"]
    : // Nothing to withdraw, so เบิก is not offered at all rather than offered
      // and refused on submit.
      ["request", "self"];

  const offered = ordered.filter((p) => allowed.includes(p));

  // `request` is in every ordering and is the one path no caller reaching this
  // sheet lacks, so `offered` cannot be empty for any real caller. The fallback
  // states that rather than leaving a non-null assertion to imply it.
  return { primary: offered[0] ?? "request", secondary: offered.slice(1) };
}

/**
 * Spec 363 U4 merge — which paths a ROLE may take in the `ต้องการของ` sheet.
 * `null` means "no restriction", which is not the same as an empty array: an
 * empty array would close the sheet for everyone rather than leave it open.
 *
 * The whole reason this exists is that the sheet became the only door to all
 * three write paths when คำขอซื้อ was deleted. Plain `procurement` is the
 * read-only WP viewer, but the purchase request is its ONE write here — the
 * `purchase_requests` INSERT policy admits the role unconditionally — so gating
 * the sheet on `!readOnly` would have deleted a working capability. It gets the
 * request and nothing else: `issue_stock` excludes it and the self-purchase RPC
 * is a site-staff surface, so offering either would be offer-then-refuse.
 *
 * Derived from `isReadOnlyWpViewer` rather than re-listing the role, so the two
 * cannot drift: the page branches on that same predicate for every other
 * affordance.
 */
export function allowedNeedPaths(role: UserRole): readonly NeedPath[] | null {
  return isReadOnlyWpViewer(role) ? (["request"] as const) : null;
}
