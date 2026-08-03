"use client";

// Spec 389 U5 — the PD-tier star toggle on a REVIEW-page photo tile. Rendered
// only when PhaseGallery receives the starring prop (review page, PD-tier
// role, mapped WP) — the button itself trusts nothing: the RPC re-gates
// (42501).

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { starReferencePhoto, unstarReferencePhoto } from "@/lib/wp-catalog/star-actions";

export function ReferenceStarButton({
  projectId,
  workPackageId,
  photoId,
  starred,
}: {
  projectId: string;
  workPackageId: string;
  photoId: string;
  starred: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const res = starred
        ? await unstarReferencePhoto(projectId, workPackageId, photoId)
        : await starReferencePhoto(projectId, workPackageId, photoId);
      if (!res.ok) setError(res.error ?? "บันทึกดาวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label={starred ? "เอาดาวออก (เลิกใช้เป็นตัวอย่าง)" : "ปักดาวเป็นตัวอย่างงาน"}
        disabled={pending}
        onClick={toggle}
        className="absolute top-1 right-1 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Star
          aria-hidden
          className={starred ? "fill-attn-edge text-attn-edge h-5 w-5" : "h-5 w-5 text-white"}
        />
      </button>
      {error ? (
        <span
          role="alert"
          className="absolute inset-x-0 top-11 z-10 line-clamp-3 bg-black/70 px-1 py-0.5 text-[10px] break-words text-white"
        >
          {error}
        </span>
      ) : null}
    </>
  );
}
