// Spec 355 U3 — the reasoned reject-evidence note on the WP-detail attention
// card: reason chip + per-reason guidance + the tailored CTA. Replaces the
// generic spec-353 phase CTA only when the decision carries a structured reason
// (the page falls back for historical null-reason rows). `premature` renders no
// photo jump — its next action (finish the work) happens off-app.

import Link from "next/link";
import { Camera } from "lucide-react";

import type { ApprovalRevisionReason } from "@/lib/db/enums";
import { APPROVAL_REVISION_REASON_LABEL, REVISION_REASON_GUIDANCE } from "@/lib/i18n/labels";

export function RevisionReasonGuidance({
  reason,
  showCta,
}: {
  reason: ApprovalRevisionReason;
  /** false for read-only viewers — keep the explanation, drop the action. */
  showCta: boolean;
}) {
  const g = REVISION_REASON_GUIDANCE[reason];
  return (
    <div className="mt-1.5">
      <span className="bg-attn text-on-attn text-meta rounded-full px-2 py-0.5 font-bold whitespace-nowrap">
        {APPROVAL_REVISION_REASON_LABEL[reason]}
      </span>
      <p className="mt-1.5">{g.guidance}</p>
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
