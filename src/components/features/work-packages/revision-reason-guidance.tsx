// Spec 355 U3 — the reasoned reject-evidence note on the WP-detail attention
// card: per-reason guidance + the tailored CTA (the card TITLE carries the
// reason label — the page swaps it in). Replaces the generic spec-353 phase CTA
// only when the decision carries a structured reason (the page falls back for
// historical null-reason rows). `premature` renders no photo jump — its next
// action (finish the work) happens off-app.

import Link from "next/link";
import { Camera } from "lucide-react";

import type { ApprovalRevisionReason } from "@/lib/db/enums";
import { FLAGGABLE_PHASES, type FlaggablePhase } from "@/lib/approvals/predicates";
import { PHOTO_PHASE_LABEL, REVISION_REASON_GUIDANCE } from "@/lib/i18n/labels";

export function RevisionReasonGuidance({
  reason,
  showCta,
  flaggedPhases = [],
  flaggedPhotos = [],
}: {
  reason: ApprovalRevisionReason;
  /** false for read-only viewers AND answered bounces (the spec-291 delete
   *  window is closed once the SA presses ส่งตรวจอีกครั้ง — a delete CTA there
   *  would offer-then-refuse). The explanation stays either way. */
  showCta: boolean;
  /** Spec 372 U4a — which lifecycle phases the PM said are missing. Optional at
   *  every layer: the PM may bounce without saying, and older decisions carry
   *  none. Empty renders nothing rather than an empty heading. */
  flaggedPhases?: ReadonlyArray<FlaggablePhase>;
  /** Spec 372 U4b — which existing photos the PM said are the wrong ones, named the
   *  way the SA sees them on the tile. `seq` is a PER-PHASE ordinal (spec 340), so the
   *  phase always rides with it — "#3" alone points at two different photos. */
  flaggedPhotos?: ReadonlyArray<{ phase: FlaggablePhase; seq: number }>;
}) {
  const g = REVISION_REASON_GUIDANCE[reason];
  // Capture order, not the order the PM happened to tick them in — the SA reads this
  // against the phase strip, which is always ก่อน → ระหว่าง → หลัง.
  const named = FLAGGABLE_PHASES.filter((ph) => flaggedPhases.includes(ph));
  // Capture order across phases, then number within one — the order the SA scans the
  // strip in, not the order the PM happened to tap.
  const namedPhotos = [...flaggedPhotos].sort(
    (a, b) =>
      FLAGGABLE_PHASES.indexOf(a.phase) - FLAGGABLE_PHASES.indexOf(b.phase) || a.seq - b.seq,
  );
  return (
    <div className="mt-1.5">
      <p>{g.guidance}</p>
      {named.length > 0 ? (
        <p className="mt-1 font-semibold">
          ช่วงที่ยังขาด: {named.map((ph) => PHOTO_PHASE_LABEL[ph]).join(" · ")}
        </p>
      ) : null}
      {namedPhotos.length > 0 ? (
        <p className="mt-1 font-semibold">
          รูปที่ต้องเปลี่ยน:{" "}
          {namedPhotos.map((p) => PHOTO_PHASE_LABEL[p.phase] + " #" + p.seq).join(" · ")}
        </p>
      ) : null}
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
