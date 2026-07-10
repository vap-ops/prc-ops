"use client";

// Spec 277 P0 — the floating ถ่ายรูป FAB on the SA home. Capture is the daily loop's
// most-used action, so it always floats (never scrolls away). No new capture path:
// it routes into the existing WP-detail photo deep-link (#wp-photos) and records
// /sa as the referrer so the WP back chip returns home. A single active WP → a
// direct link; several → a เลือกงาน picker then navigate. Mirrors DailyHero's photo
// path, lifted out as a persistent control. 'use client': picker state + router.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";

export type CameraFabWp = { id: string; projectId: string; code: string; name: string };

const PHOTO_HASH = "#wp-photos";
const LABEL = "ถ่ายรูป";
const FAB_CLASS =
  "fixed bottom-24 right-5 z-30 flex size-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-attn text-on-attn shadow-card transition-colors hover:bg-attn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px";

const photoTarget = (w: CameraFabWp) =>
  withBackFrom(`${workPackageHref(w.projectId, w.id)}${PHOTO_HASH}`, "/sa");

export function CameraFab({ wps }: { wps: CameraFabWp[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (wps.length === 0) return null;
  const single = wps.length === 1 ? wps[0]! : null;

  return (
    <>
      {single ? (
        <Link href={photoTarget(single)} aria-label={LABEL} className={FAB_CLASS}>
          <Camera aria-hidden className="size-6 shrink-0" />
        </Link>
      ) : (
        <button
          type="button"
          aria-label={LABEL}
          onClick={() => setOpen(true)}
          className={FAB_CLASS}
        >
          <Camera aria-hidden className="size-6 shrink-0" />
        </button>
      )}

      <BottomSheet open={open} title="เลือกงาน" onClose={() => setOpen(false)}>
        <ul className="flex flex-col gap-2">
          {wps.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => {
                  router.push(photoTarget(w));
                  setOpen(false);
                }}
                className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-control flex w-full items-center gap-2 border px-4 py-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2"
              >
                <span className="text-ink-secondary shrink-0 font-mono text-xs">{w.code}</span>
                <span className="text-ink truncate font-medium">{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
