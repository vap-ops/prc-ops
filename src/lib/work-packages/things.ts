// Spec 363 U4 slice 2 — the `ของ` tab's one state-grouped list.
//
// D5: the list is ITEM-first, not path-first. Withdraw-vs-request-vs-self-buy is
// the firm's ledger taxonomy; the SA's state is "I need ปูน, where is it?". So
// path is a per-row state, not a level of navigation, and one list answers it.
//
// The group set was locked with the operator 2026-07-27 against live counts. The
// spec's original three groups (รออนุมัติ / อยู่ที่งานนี้ / คืนแล้ว) left two
// real populations homeless:
//   • `delivered` — 131 of the pilot's 170 provenance-linked requests. Store-first
//     doctrine sends a delivered request to the STORE, not to the WP.
//
//     ⚠️ CORRECTED after fresh-eyes: this was first shipped as a prominent
//     มาถึงคลังแล้ว group meaning "go draw it". That claim is NOT derivable.
//     `delivered` is TERMINAL on purchase_requests — nothing flips it once the
//     material is drawn, and `stock_issues` carries no purchase_request_id (only
//     `stock_receipts` does), so we cannot tell a request whose goods are still
//     on the shelf from one already เบิก'd to this very WP. A prominent group
//     would therefore grow forever AND double-count the same physical goods
//     against the issue row in อยู่ที่งานนี้. It is a HISTORY of fulfilment, so it
//     is labelled and collapsed as one.
//   • `rejected` / `cancelled` — 33 rows. Collapsed ปิดแล้ว, so "what happened to
//     my ขอซื้อ" is answerable without leaving the WP.
//
// ⚠️ Spec §D5 named the awaiting set `requested · approved · shipped`. There is no
// `shipped` status — the live enum is requested/approved/rejected/cancelled/
// purchased/on_route/delivered/site_purchased. Iterating the full domain in the
// test is what surfaced that.

import type { PurchaseRequestStatus } from "@/lib/db/enums";

export type WpThingGroupKey = "awaiting" | "at_store" | "here" | "returned" | "closed";

export interface WpThingRequest {
  id: string;
  prNumber: number;
  itemDescription: string;
  quantity: number;
  unit: string;
  status: PurchaseRequestStatus;
  requestedAt: string;
}

export interface WpThingIssue {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  returnedQty: number;
  issuedAt: string;
}

export type WpThingRow =
  | ({ kind: "request" } & WpThingRequest)
  | ({ kind: "issue" } & WpThingIssue);

export interface WpThingGroup {
  key: WpThingGroupKey;
  label: string;
  /** Retrospective groups render collapsed — present, but not competing for attention. */
  collapsed: boolean;
  rows: WpThingRow[];
}

/** Group order = what the SA acts on first; the two retrospective ones sink. */
export const WP_THING_GROUPS: readonly {
  key: WpThingGroupKey;
  label: string;
  collapsed: boolean;
}[] = [
  { key: "awaiting", label: "รออนุมัติ", collapsed: false },
  { key: "here", label: "อยู่ที่งานนี้", collapsed: false },
  { key: "at_store", label: "ขอซื้อที่ได้รับแล้ว", collapsed: true },
  { key: "returned", label: "คืนแล้ว", collapsed: true },
  { key: "closed", label: "ปิดแล้ว", collapsed: true },
] as const;

/**
 * Which group a REQUEST belongs to. Exhaustive over the live enum — adding a
 * status without deciding its home is a type error here, not a silent omission
 * from the SA's list.
 */
function groupForRequest(status: PurchaseRequestStatus): WpThingGroupKey {
  switch (status) {
    case "requested":
    case "approved":
    case "purchased":
    case "on_route":
      return "awaiting";
    case "delivered":
      return "at_store";
    // Same shape as `delivered`: a cash buy is a fulfilment EVENT, and nothing
    // flips it when the material is consumed, so it belongs with the history
    // rather than asserting the goods are still on site.
    case "site_purchased":
      return "at_store";
    case "rejected":
    case "cancelled":
      return "closed";
  }
}

export function groupWpThings(input: {
  requests: readonly WpThingRequest[];
  issues: readonly WpThingIssue[];
}): WpThingGroup[] {
  const byKey = new Map<WpThingGroupKey, WpThingRow[]>(WP_THING_GROUPS.map((g) => [g.key, []]));

  for (const r of input.requests) {
    byKey.get(groupForRequest(r.status))!.push({ kind: "request", ...r });
  }

  for (const i of input.issues) {
    // A partly-returned issue is BOTH: some of it is still on site and some came
    // back. Reporting only one reading would misstate what the WP holds.
    if (i.qty - i.returnedQty > 0) byKey.get("here")!.push({ kind: "issue", ...i });
    if (i.returnedQty > 0) byKey.get("returned")!.push({ kind: "issue", ...i });
  }

  // Newest first WITHIN each group. Without this the rows sit requests-then-issues
  // purely by insertion order, so อยู่ที่งานนี้ would stack unrelated-age rows in an
  // order that means nothing — and the timestamps the row types carry would be
  // dead weight.
  const at = (r: WpThingRow) => (r.kind === "request" ? r.requestedAt : r.issuedAt);

  // Every group is returned even when empty so the rendered shape is stable and
  // a group's absence never has to be distinguished from its emptiness.
  return WP_THING_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    collapsed: g.collapsed,
    rows: [...byKey.get(g.key)!].sort((a, b) => at(b).localeCompare(at(a))),
  }));
}
