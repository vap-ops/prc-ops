// Shared status-color helper for the SA-side pills (project list, WP
// list). The palette here matches the PM-side pills already in use on
//   - src/app/review/page.tsx (approval-decision pill)
//   - src/app/projects/[projectId]/reports/reports-list.tsx (report
//     status pill)
//   - src/app/review/work-packages/[workPackageId]/page.tsx (decision-
//     history pill)
//
// Same four palette slots, picked to keep the whole app visually
// consistent without restyling the PM pills in this PR:
//
//   zinc    — neutral / idle / default
//   amber   — in-flight / needs attention
//   emerald — positive terminal (done, completed, success)
//   muted   — closed / hidden / archived (zinc, but dimmer text)
//
// The helpers are pure / typed / exhaustive on the enum unions. The
// exhaustiveness check (the `_exhaustive: never` assignment at the end
// of each switch) means adding a new enum value to the database will
// cause a TypeScript error here — exactly the place to update the map.

import type {
  ApprovalDecision,
  ProjectStatus,
  PurchaseRequestPriority,
  PurchaseRequestStatus,
  ReportStatus,
  WorkPackageStatus,
} from "@/lib/db/enums";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";

export type {
  ApprovalDecision,
  ProjectStatus,
  PurchaseRequestPriority,
  PurchaseRequestStatus,
  ReportStatus,
  WorkPackageStatus,
};

// Spec 20 sun palette: solid saturated fills, not dark translucent
// tints — a pill must be identifiable by hue at arm's length in glare.
// Amber carries ink text (white-on-amber fails contrast); emerald/red
// carry white text on 600-weight fills.
const PILL_ZINC = "border-zinc-400 bg-zinc-200 text-zinc-900";
const PILL_AMBER = "border-amber-600 bg-amber-400 text-zinc-950";
// emerald-700 fill: white-on-emerald-600 is 3.67:1 (AA fail); 700 gives
// 5.37:1 (AA pass) while keeping the positive hue identifiable.
const PILL_EMERALD = "border-emerald-800 bg-emerald-700 text-white";
const PILL_RED = "border-red-700 bg-red-600 text-white";
// sky-700 fill: white-on-sky-600 is ~3.7:1 (AA fail); 700 passes while
// staying clearly "in transit" blue, distinct from the blue-700 action hue.
const PILL_SKY = "border-sky-800 bg-sky-700 text-white";
const PILL_MUTED = "border-zinc-300 bg-zinc-100 text-zinc-600";

export function projectStatusPillClasses(status: ProjectStatus): string {
  switch (status) {
    case "active":
      // Default resting state. Most projects sit here; using zinc keeps
      // the project list calm instead of every row screaming "look at me."
      return PILL_ZINC;
    case "on_hold":
      // Paused, needs human decision to resume — amber to signal that.
      return PILL_AMBER;
    case "completed":
      // Positive terminal — same emerald as the WP `complete` and the
      // report `ready` pill on the PM side.
      return PILL_EMERALD;
    case "archived":
      // Closed / hidden from active work. Muted so it visibly drops
      // back from active rows.
      return PILL_MUTED;
    default: {
      // Exhaustiveness check + defensive runtime fallback for any
      // future enum value that lands before this file is updated.
      const _exhaustive: never = status;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}

// Latest-decision pill on the PM queue and the decision-history pill on
// the review screen. null = no decision yet (awaiting first review).
export function approvalDecisionPillClasses(decision: ApprovalDecision | null): string {
  switch (decision) {
    case "approved":
      return PILL_EMERALD;
    case "rejected":
      return PILL_RED;
    case "needs_revision":
      return PILL_AMBER;
    case null:
      // Awaiting first review — idle default.
      return PILL_ZINC;
    default: {
      const _exhaustive: never = decision;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}

export function reportStatusPillClasses(status: ReportStatus): string {
  switch (status) {
    case "requested":
      // Queued, worker hasn't picked it up — idle default.
      return PILL_ZINC;
    case "processing":
      // Worker is generating the PDF — in flight.
      return PILL_AMBER;
    case "complete":
      return PILL_EMERALD;
    case "failed":
      return PILL_RED;
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}

// Requester-set urgency (spec 16). normal renders no pill on the cards
// (the quiet default — only escalations draw the eye); the map still
// covers it for completeness and the fallback path.
export function purchaseRequestPriorityPillClasses(priority: PurchaseRequestPriority): string {
  switch (priority) {
    case "normal":
      return PILL_ZINC;
    case "urgent":
      return PILL_AMBER;
    case "critical":
      return PILL_RED;
    default: {
      const _exhaustive: never = priority;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}

export function purchaseRequestStatusPillClasses(status: PurchaseRequestStatus): string {
  switch (status) {
    case "requested":
      // Idle default — sitting in the PM's queue, same zinc as
      // `not_started` on the WP side.
      return PILL_ZINC;
    case "approved":
      // Positive: the PM said yes; procurement takes over from here.
      return PILL_EMERALD;
    case "rejected":
      // Negative terminal — the only red pill in the purchasing flow.
      // The rejection comment block on /requests explains why.
      return PILL_RED;
    case "cancelled":
      // Administrative close (ADR 0031) — muted like archived projects,
      // not red: nothing was refused, the need simply went away.
      return PILL_MUTED;
    case "purchased":
      // In flight with the back office (AppSheet) — goods ordered but
      // not yet on site. Amber, like the in-flight WP statuses.
      return PILL_AMBER;
    case "on_route":
      // Goods physically moving (shipped_at set by the back office,
      // ADR 0027). Sky — between amber "ordered" and emerald "received".
      return PILL_SKY;
    case "delivered":
      // Positive terminal — goods received on site.
      return PILL_EMERALD;
    case "site_purchased":
      // On-site cash purchase (ADR 0043) — goods already on site; a
      // positive terminal like delivered. The source='site_purchase' +
      // acknowledged_at badge carries the "awaiting PM acknowledgement"
      // signal separately, so the pill stays a clean terminal hue.
      return PILL_EMERALD;
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}

// Spec 134 / ADR 0044 — the derived PO roll-up status pill. The union is not a
// DB enum (it lives in purchasing/purchase-order.ts); the four states map onto the
// same palette as the per-ticket flow so a PO badge reads consistently with its
// member tickets: open idle, ordered in-flight (amber, like 'purchased'),
// partially_received between (sky, like 'on_route'), received positive terminal.
export function purchaseOrderStatusPillClasses(status: PurchaseOrderStatus): string {
  switch (status) {
    case "open":
      return PILL_ZINC;
    case "ordered":
      return PILL_AMBER;
    case "partially_received":
      return PILL_SKY;
    case "received":
      return PILL_EMERALD;
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}

export function workPackageStatusPillClasses(status: WorkPackageStatus): string {
  switch (status) {
    case "not_started":
      // Idle default — same zinc as the PM-side `requested` pill.
      return PILL_ZINC;
    case "in_progress":
    case "on_hold":
    case "pending_approval":
      // All three are "in flight" from the SA's perspective: work is
      // happening, paused, or with the PM. Amber across the board;
      // the pill text label is what tells them apart precisely. Same
      // amber the PM side uses for `processing` / `needs_revision`.
      return PILL_AMBER;
    case "complete":
      // Positive terminal — same emerald as PM `complete` report.
      return PILL_EMERALD;
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return PILL_ZINC;
    }
  }
}
