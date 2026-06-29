import { Hash } from "lucide-react";

import { formatFeedbackNumber } from "@/lib/feedback/format-id";

// The human feedback code chip (FB-0007). One render path so the code reads
// identically across the triage kanban, the detail header, and the reporter's
// own list — the operator referred to records by their unusable UUID, this gives
// each report a short citable code. Mirrors PoNumberTag. Server-safe (no
// 'use client', no handlers) so it drops into server pages and the kanban alike.
export function FeedbackNumberTag({
  feedbackNumber,
  className = "",
}: {
  feedbackNumber: number | null;
  className?: string;
}) {
  return (
    <span
      className={`border-edge bg-sunk text-ink-secondary inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs ${className}`}
    >
      <Hash aria-hidden className="size-3 shrink-0" />
      {formatFeedbackNumber(feedbackNumber)}
    </span>
  );
}
