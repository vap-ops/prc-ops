// Spec 355 U3 — the reasoned reject-evidence note on the WP-detail attention
// card: per-reason guidance + the tailored CTA (the card TITLE carries the
// reason label — the page swaps it in). Replaces the generic spec-353 phase CTA
// only when the decision carries a structured reason (the page falls back for
// historical null-reason rows). `premature` renders no photo jump — its next
// action (finish the work) happens off-app.

import Link from "next/link";
import { Camera } from "lucide-react";

import type { ApprovalRevisionReason } from "@/lib/db/enums";
import { REVISION_REASON_GUIDANCE } from "@/lib/i18n/labels";

export function RevisionReasonGuidance({
  reason,
  showCta,
}: {
  reason: ApprovalRevisionReason;
  /** false for read-only viewers AND answered bounces (the spec-291 delete
   *  window is closed once the SA presses ส่งตรวจอีกครั้ง — a delete CTA there
   *  would offer-then-refuse). The explanation stays either way. */
  showCta: boolean;
}) {
  const g = REVISION_REASON_GUIDANCE[reason];
  return (
    <div className="mt-1.5">
      <p>{g.guidance}</p>
      {showCta && reason !== "premature" ? (
        <Link
          href="#wp-photos"
          className="bg-attn-press text-on-attn rounded-control focus-visible:ring-action mt-2.5 inline-flex h-9 items-center gap-1.5 px-3 text-sm font-bold focus:outline-none focus-visible:ring-2"
        >
          <Camera aria-hidden className="size-4" />
          {g.cta}
        </Link>
      ) : null}
    </div>
  );
}
