// Spec 402 — the five-slot plain-text skeleton every push notification is
// composed onto.
//
// ⛔ There is deliberately NO link slot, and no link builders. U1–U3 shipped a
// sixth slot carrying a deep link; the operator refuted it on 2026-08-07:
// "users have pwa installed, links take them to browser, not to mention login
// problem." Both halves are structural, not fixable from the message —
// LINE/Telegram open their own in-app WebView (separate cookie jar ⇒ logged
// out), and an iOS home-screen PWA cannot capture a link at all, so a field
// user can never be taken to the app they actually work in. The message's job
// is to say enough that nothing needs opening. See tests/unit/
// notification-no-deep-links.test.ts before adding one back.
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
type ApprovalDecision = Database["public"]["Enums"]["approval_decision"];
type FeedbackType = Database["public"]["Enums"]["feedback_type"];

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
  /** L5 — a comment or reason the user actually wrote. The last slot: see the
   *  header for why there is no sixth one carrying a URL. */
  note?: string | undefined;
}

/**
 * Render the slots that resolved, one per line, in skeleton order.
 *
 * A slot the drain could not resolve arrives as `undefined` or an empty/blank
 * string and is DROPPED — never rendered as a dangling `โดย` or a literal
 * "undefined" (the honest-copy rule).
 */
export function buildNotificationMessage(slots: NotificationSlots): string {
  return [slots.headline, slots.subject, slots.where, slots.actor, slots.note]
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

/** One icon per feedback type, so a bug and a wish are distinguishable in the
 *  operator's notification shelf. Exhaustive over the enum, like the two below. */
export const FEEDBACK_TYPE_ICON: Record<FeedbackType, string> = {
  bug: "🐞",
  feature: "💡",
};

/**
 * One icon per approval decision. Same exhaustiveness contract as
 * PR_STATUS_ICON: a Record over the enum, so a new `approval_decision` value
 * fails the compile instead of rendering a blank headline.
 */
export const WP_DECISION_ICON: Record<ApprovalDecision, string> = {
  approved: "✅",
  rejected: "⛔",
  needs_revision: "🔁",
};

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
