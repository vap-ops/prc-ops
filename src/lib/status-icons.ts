// Spec 211 U4 — status ICON SSOT, parallel to status-colors.ts. Every status pill
// carries an icon as a COLOUR-INDEPENDENT cue: it keeps a status identifiable in
// sun glare when the hue washes out (spec-20 sun-readability), helps colour-blind
// users, and tells the states apart at a glance. StatusPill renders it, so the
// icon is identical on the worklist AND every detail page / card / tracker.
//
// Cross-domain consistency (the same real meaning → the same glyph everywhere):
//   Check = positive/done · X = negative · Clock = waiting · Truck = shipping ·
//   PackageCheck = received/delivered · Pause = on hold.
// Maps are Record<Enum, LucideIcon> so a new enum value is a TYPE error here —
// exactly the place to add its icon (mirrors status-colors.ts exhaustiveness).

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  Ban,
  Check,
  Circle,
  CircleDashed,
  Clock,
  FileText,
  Flame,
  Hammer,
  Loader,
  Minus,
  PackageCheck,
  PackageOpen,
  Pause,
  PenLine,
  RotateCcw,
  Send,
  ShoppingCart,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import type {
  ApprovalDecision,
  ProjectStatus,
  PurchaseRequestPriority,
  PurchaseRequestStatus,
  ReportStatus,
  WorkPackageStatus,
} from "@/lib/db/enums";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";

const WORK_PACKAGE_STATUS_ICON: Record<WorkPackageStatus, LucideIcon> = {
  not_started: Circle,
  in_progress: Hammer,
  on_hold: Pause,
  complete: Check,
  pending_approval: Clock,
  rework: RotateCcw,
};
export function workPackageStatusIcon(status: WorkPackageStatus): LucideIcon {
  return WORK_PACKAGE_STATUS_ICON[status];
}

const PROJECT_STATUS_ICON: Record<ProjectStatus, LucideIcon> = {
  active: Hammer,
  on_hold: Pause,
  completed: Check,
  archived: Archive,
};
export function projectStatusIcon(status: ProjectStatus): LucideIcon {
  return PROJECT_STATUS_ICON[status];
}

const APPROVAL_DECISION_ICON: Record<ApprovalDecision, LucideIcon> = {
  approved: Check,
  rejected: X,
  needs_revision: PenLine,
};
// null = no decision yet (the awaiting state) → a waiting glyph.
export function approvalDecisionIcon(decision: ApprovalDecision | null): LucideIcon {
  return decision ? APPROVAL_DECISION_ICON[decision] : Clock;
}

const REPORT_STATUS_ICON: Record<ReportStatus, LucideIcon> = {
  requested: Clock,
  processing: Loader,
  complete: Check,
  failed: X,
};
export function reportStatusIcon(status: ReportStatus): LucideIcon {
  return REPORT_STATUS_ICON[status];
}

const PURCHASE_REQUEST_PRIORITY_ICON: Record<PurchaseRequestPriority, LucideIcon> = {
  normal: Minus,
  urgent: AlertTriangle,
  critical: Flame,
};
export function purchaseRequestPriorityIcon(priority: PurchaseRequestPriority): LucideIcon {
  return PURCHASE_REQUEST_PRIORITY_ICON[priority];
}

const PURCHASE_REQUEST_STATUS_ICON: Record<PurchaseRequestStatus, LucideIcon> = {
  requested: Send,
  approved: Check,
  rejected: X,
  cancelled: Ban,
  purchased: ShoppingCart,
  on_route: Truck,
  delivered: PackageCheck,
  site_purchased: Wallet,
};
export function purchaseRequestStatusIcon(status: PurchaseRequestStatus): LucideIcon {
  return PURCHASE_REQUEST_STATUS_ICON[status];
}

// PO roll-up: 'ordered' uses a document glyph (the PO is ISSUED — "ออกใบสั่งซื้อ"),
// distinct from a PR line's ShoppingCart 'purchased', while in_transit/received
// share the shipping/received glyphs with the line flow. 'open' (draft, not yet
// issued) uses a DASHED circle — a bare Circle reads as an empty placeholder.
const PURCHASE_ORDER_STATUS_ICON: Record<PurchaseOrderStatus, LucideIcon> = {
  open: CircleDashed,
  ordered: FileText,
  in_transit: Truck,
  partially_received: PackageOpen,
  received: PackageCheck,
};
export function purchaseOrderStatusIcon(status: PurchaseOrderStatus): LucideIcon {
  return PURCHASE_ORDER_STATUS_ICON[status];
}
