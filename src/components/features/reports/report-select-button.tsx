"use client";

// Spec 394 U2 — the per-photo CLIENT-REPORT toggle on a review-page tile.
// Sibling of ReferenceStarButton and deliberately independent of it: the two
// answer different questions ("a good example of this KIND of work" vs "show
// THIS to THIS client"), the gates differ (PM_ROLES here, PD tier there), and
// an UNMAPPED work package shows this toggle while showing no star at all.
//
// The button trusts nothing: the RPC re-gates (42501) and the action owns the
// honest copy for every permanent refusal.

import { useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { selectReportPhoto, unselectReportPhoto } from "@/lib/reports/report-selection-actions";

export function ReportSelectButton({
  workPackageId,
  photoId,
  selected,
}: {
  workPackageId: string;
  photoId: string;
  selected: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const res = selected
        ? await unselectReportPhoto(workPackageId, photoId)
        : await selectReportPhoto(workPackageId, photoId);
      if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    });
  };

  return (
    <>
      <button
        type="button"
        // ลูกค้า is explicit on purpose: "รายงาน" alone collides with the
        // procurement reports at /requests/reports.
        aria-label={selected ? "เอาออกจากรายงานลูกค้า" : "เลือกใช้ในรายงานลูกค้า"}
        disabled={pending}
        onClick={toggle}
        // right-12 (48px) + w-11 (44px) ⇒ this occupies 48→92px from the right,
        // clear of the star's 4→44px. h-11, not the star's grandfathered h-10:
        // a new control on a gloved-hand field surface does not inherit that
        // debt. On a 112px tile the two top controls then span x 20→108 — no
        // overlap, but the tile is fully clad; a THIRD top control does not fit.
        className="absolute top-1 right-12 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <FileText
          aria-hidden
          className={selected ? "text-done-edge h-5 w-5 fill-current" : "h-5 w-5 text-white"}
        />
      </button>
      {error ? (
        // bottom-8 rather than the star's top-11, so the two banners do not
        // start in the same place. ⚠️ They still OVERLAP on a 112px tile (the
        // star's spans y≈44→92, this one y≈32→80) — reaching that needs a star
        // failure and a select failure on the SAME tile at the same moment, so
        // it is accepted rather than solved; do not read this offset as a
        // guarantee of separation.
        // pointer-events-none for the same reason as the star's — a refusal on
        // one control must not make its neighbour unclickable.
        <span
          role="alert"
          className="pointer-events-none absolute inset-x-0 bottom-8 z-10 line-clamp-3 bg-black/70 px-1 py-0.5 text-[10px] break-words text-white"
        >
          {error}
        </span>
      ) : null}
    </>
  );
}
