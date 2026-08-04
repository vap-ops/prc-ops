"use client";

// Spec 389 U5 — the PD-tier star toggle on a REVIEW-page photo tile. Rendered
// only when PhaseGallery receives the starring prop (review page, PD-tier
// role, mapped WP) — the button itself trusts nothing: the RPC re-gates
// (42501).

import { useState, useTransition } from "react";
import { EyeOff, Star } from "lucide-react";
import {
  hideReferencePhoto,
  starReferencePhoto,
  unhideReferencePhoto,
  unstarReferencePhoto,
} from "@/lib/wp-catalog/star-actions";

export function ReferenceStarButton({
  projectId,
  workPackageId,
  photoId,
  starred,
  hidden,
}: {
  projectId: string;
  workPackageId: string;
  photoId: string;
  starred: boolean;
  /** Spec 391 D5 — suppressed as an example everywhere. Independent of `starred`:
   *  a photo can be neither, either, or both, and hiding wins. Shown as its own
   *  control rather than a third star state, because they answer different
   *  questions — "is this the best example" vs "never use this one". */
  hidden: boolean;
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

  const toggleHidden = () => {
    setError(null);
    startTransition(async () => {
      const res = hidden
        ? await unhideReferencePhoto(projectId, workPackageId, photoId)
        : await hideReferencePhoto(projectId, workPackageId, photoId);
      if (!res.ok) setError(res.error ?? "ซ่อนรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
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
      {/* Spec 391 D5 — ไม่ใช้เป็นตัวอย่าง. Sits BELOW the star, same 40px target
          (a gloved hand on a phone). It is the only control that answers a bad
          automatic pick: since 391 most of what appears in ตัวอย่างงาน was never
          starred, so there is no star to remove. */}
      <button
        type="button"
        aria-label={hidden ? "ใช้เป็นตัวอย่างได้อีกครั้ง" : "ไม่ใช้รูปนี้เป็นตัวอย่าง"}
        aria-pressed={hidden}
        disabled={pending}
        onClick={toggleHidden}
        className="absolute top-12 right-1 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <EyeOff aria-hidden className={hidden ? "text-attn-edge h-5 w-5" : "h-5 w-5 text-white"} />
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
