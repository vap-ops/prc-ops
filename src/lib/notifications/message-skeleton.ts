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
import { workPackageHref } from "@/lib/nav/project-paths";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];
type ApprovalDecision = Database["public"]["Enums"]["approval_decision"];

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
 * Spec 402 U2 — the work package on its OWN detail page, via the nav SSOT so
 * the route shape lives in one place. Gate: WP_DETAIL_ROLES, the wider of the
 * two, which is why the events whose recipients are photo UPLOADERS
 * (wp_decision, wp_reopened) point here.
 */
export function workPackageLink(baseUrl: string, projectId: string, workPackageId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${workPackageHref(projectId, workPackageId)}`;
}

/**
 * The same work package in the REVIEW QUEUE — where a decider acts on it, and
 * reachable without knowing the project.
 *
 * 🚨 `/review/work-packages/[id]` is `requireRole(PM_ROLES)`. Only use this for
 * events whose recipients are all manager-tier: wp_pending_approval (the PM
 * pool) and wp_evidence_resubmitted (the decider being answered). Pointing an
 * uploader at it would redirect them away.
 */
export function reviewWorkPackageLink(baseUrl: string, workPackageId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/review/work-packages/${workPackageId}`;
}

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
