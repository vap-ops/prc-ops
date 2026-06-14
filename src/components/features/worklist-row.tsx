// WorklistRow (Field-First): the action-state row. The WHOLE row is one
// Link to the WP detail (single-anchor pattern preserved from spec 47),
// where the thumb-anchored capture bar lives. A coloured status spine
// encodes the action band at arm's length; the precise status pill
// carries semantics (frozen); a status-level next-action hint tells the
// operator what the tap is for; the deliverable rides as a demoted tag.
//
// Priority surfaces two ways, by design:
//   • `priority` (manual urgency flag) → a "ด่วน" tag, may be lit today.
//   • `isCritical` (the future critical-path engine) → the RESERVED
//     CRITICAL_BADGE. False for every WP now, so it renders nowhere yet —
//     the slot exists and is style-pinned for when the engine lights it.

import Link from "next/link";
import { ChevronRight, Camera, UserPlus, PauseCircle, AlertTriangle, Flame } from "lucide-react";
import { workPackageHref } from "@/lib/nav/project-paths";
import { StatusPill } from "@/components/features/status-pill";
import { CRITICAL_BADGE } from "@/lib/ui/classes";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import {
  nextAction,
  type NextActionKind,
  type WorkPackageStatus,
  type WpPriority,
} from "@/lib/work-packages/action-bands";

// next-action verb → its icon. assign = bring a contractor on; capture =
// shoot photos; wait = held, nothing to do now.
const ACTION_ICON: Record<NextActionKind, typeof Camera> = {
  assign: UserPlus,
  capture: Camera,
  wait: PauseCircle,
};

export interface WorklistRowItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  /** Whether a contractor is assigned — drives the next-action verb. */
  hasContractor: boolean;
  /** Manual urgency flag (data layer supplies it). */
  priority: WpPriority;
  /** Critical-path flag (future engine; false for all today). */
  isCritical: boolean;
  /** Demoted deliverable label, or null in flat / ungrouped mode. */
  deliverableLabel: string | null;
}

interface WorklistRowProps {
  projectId: string;
  wp: WorklistRowItem;
  /** Token spine colour utility for this row's band. */
  spine: string;
  /** Compact density for the review/done bands (one-line name). */
  compact?: boolean;
}

export function WorklistRow({ projectId, wp, spine, compact = false }: WorklistRowProps) {
  const action = compact ? null : nextAction(wp.status, wp.hasContractor);
  const ActionIcon = action ? ACTION_ICON[action.kind] : null;
  const showUrgent = wp.priority === "urgent" || wp.priority === "critical";
  return (
    <Link
      href={workPackageHref(projectId, wp.id)}
      className="rounded-card border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action active:bg-sunk flex items-stretch gap-0 overflow-hidden border transition-colors focus:outline-none focus-visible:ring-2"
    >
      {/* Action-band spine — the arm's-length status cue. */}
      <span aria-hidden="true" className={`w-[7px] shrink-0 ${spine}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-3 pr-1 pl-3">
        {/* Critical badge (reserved) + urgent tag ride above the name so
            they're the first thing scanned when lit. */}
        {(wp.isCritical || showUrgent) && (
          <span className="flex flex-wrap items-center gap-1.5">
            {wp.isCritical && (
              <span className={CRITICAL_BADGE}>
                <Flame aria-hidden className="h-3 w-3" />
                วิกฤต
              </span>
            )}
            {showUrgent && (
              <span className="border-attn-edge bg-attn-soft text-meta text-attn-ink inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold">
                <AlertTriangle aria-hidden className="h-3 w-3" />
                ด่วน
              </span>
            )}
          </span>
        )}
        <span
          className={`text-ink font-semibold break-words ${
            compact ? "text-body line-clamp-1" : "text-body line-clamp-2"
          }`}
        >
          {wp.name}
        </span>
        {action && ActionIcon && (
          <span className="text-meta text-attn-ink flex items-center gap-1.5 font-bold">
            <ActionIcon aria-hidden className="text-attn-press h-4 w-4" />
            {action.label}
          </span>
        )}
        <span className="text-meta text-ink-secondary flex flex-wrap items-center gap-2">
          {wp.deliverableLabel && (
            <span className="border-edge bg-sunk rounded-md border px-1.5 py-0.5 font-semibold">
              {wp.deliverableLabel}
            </span>
          )}
          <span className="font-mono">{wp.code}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end justify-center gap-1 py-3 pr-2 pl-1">
        <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)}>
          {WORK_PACKAGE_STATUS_LABEL[wp.status] ?? wp.status}
        </StatusPill>
      </span>
      <span aria-hidden="true" className="text-ink-muted flex items-center pr-2">
        <ChevronRight className="h-5 w-5" />
      </span>
    </Link>
  );
}
