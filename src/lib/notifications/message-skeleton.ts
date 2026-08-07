// Spec 402 U1 — the six-slot plain-text skeleton every push notification is
// composed onto.
//
// Both delivery channels are plain text: LINE sends `messages:[{type:"text"}]`
// (line-push.ts) and Telegram sends `sendMessage` with no `parse_mode`
// (telegram-push.ts). The Flex path exists but is wired only to the daily
// report, and the office tier is Telegram-bound — which has no Flex at all — so
// a rich bubble would give the LEAST reachable audience the best message. One
// skeleton for both channels instead (spec 402 §1).
//
// Pure: no env, no DB. The drain resolves the values; compose arranges them.

import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export interface NotificationSlots {
  /** L1 — what happened. The ONLY required slot: a phone's notification shelf
   *  truncates at one or two lines, so this carries the discriminator. */
  headline: string;
  // The optional slots accept `undefined` explicitly (the repo runs
  // exactOptionalPropertyTypes): "the drain resolved nothing" is the normal
  // case for every one of them, and the builder drops it.
  /** L2 — the subject in words (item, WP name, feedback title). Never a bare number. */
  subject?: string | undefined;
  /** L3 — where it lives: project · refs. */
  where?: string | undefined;
  /** L4 — who acted, or the status transition. */
  actor?: string | undefined;
  /** L5 — a comment or reason the user actually wrote. */
  note?: string | undefined;
  /** L6 — the deep link, always last so the channel's link affordance sits at
   *  the bottom rather than splitting the body. */
  link?: string | undefined;
}

/**
 * Render the slots that resolved, one per line, in skeleton order.
 *
 * A slot the drain could not resolve arrives as `undefined` or an empty/blank
 * string and is DROPPED — never rendered as a dangling `โดย` or a literal
 * "undefined" (the honest-copy rule).
 */
export function buildNotificationMessage(slots: NotificationSlots): string {
  return [slots.headline, slots.subject, slots.where, slots.actor, slots.note, slots.link]
    .map((slot) => slot?.trim() ?? "")
    .filter((slot) => slot !== "")
    .join("\n");
}

/** Join the L3 parts with a middle dot, dropping absent ones so no separator dangles. */
export function joinWhere(parts: ReadonlyArray<string | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" · ");
}

/**
 * The purchase-request deep link. `/requests/[requestId]` takes the PR's UUID
 * (`isValidUuid` + `.eq("id", requestId)`), which is exactly the outbox row's
 * `purchase_request_id`.
 */
export function purchaseRequestLink(baseUrl: string, purchaseRequestId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/requests/${purchaseRequestId}`;
}

/**
 * One icon per purchase-request status.
 *
 * Typed as a Record over the enum so a new `purchase_request_status` value
 * fails the compile rather than silently rendering a blank headline; the unit
 * test pins the key set against PURCHASE_REQUEST_STATUS_LABEL, which is the
 * same Record over the same enum.
 */
export const PR_STATUS_ICON: Record<PurchaseRequestStatus, string> = {
  requested: "📝",
  approved: "✅",
  rejected: "⛔",
  cancelled: "🚫",
  purchased: "🧾",
  on_route: "🚚",
  delivered: "📦",
  site_purchased: "🏗️",
};
