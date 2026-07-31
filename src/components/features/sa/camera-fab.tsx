"use client";

// Spec 277 P0 — the floating ถ่ายรูป FAB on the SA home. Capture is the daily loop's
// most-used action, so it always floats (never scrolls away). No new capture path:
// it routes into the existing WP-detail photo deep-link (#wp-photos) and records
// /sa as the referrer so the WP back chip returns home. A single active WP → a
// direct link; several → a เลือกงาน picker then navigate. Mirrors DailyHero's photo
// path, lifted out as a persistent control. 'use client': picker state + router.
//
// Spec 384 U3 — the picker gains type-to-find over code + name, mirroring
// PersonPicker's search idiom (spec 363 U4 slice 1b): focus-on-open, reset-on-close,
// matched-substring highlight. U2 widened the domain to ~178 rows (unions in every
// ต้องแก้ไข WP too), so a flat unsearchable list is now a real scroll wall.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Search } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { FIELD_INPUT } from "@/lib/ui/classes";

export type CameraFabWp = { id: string; projectId: string; code: string; name: string };

const PHOTO_HASH = "#wp-photos";
const LABEL = "ถ่ายรูป";
const SEARCH_PLACEHOLDER = "ค้นหาชื่อหรือรหัสงาน";
const FAB_CLASS =
  "fixed bottom-24 right-5 z-30 flex size-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-attn text-on-attn shadow-card transition-colors hover:bg-attn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px";

const photoTarget = (w: CameraFabWp) =>
  withBackFrom(`${workPackageHref(w.projectId, w.id)}${PHOTO_HASH}`, "/sa");

// Wraps the matched substring so the row shows WHY it matched — same affordance
// as PersonPicker/ScopedCatalogItemPicker (each keeps its own private copy;
// this is a third, following the established convention rather than a shared
// utility this spec didn't ask for).
function highlight(text: string, query: string): ReactNode {
  if (query.length === 0) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-action font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function CameraFab({ wps }: { wps: CameraFabWp[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search on open, mirroring PersonPicker — rAF so the sheet's own
  // panel-focus-on-open (BottomSheet) has already run.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (wps.length === 0) return null;
  const single = wps.length === 1 ? wps[0]! : null;

  // Reset the query on close so a reopen never resumes a stale filter and
  // shows a picker that LOOKS empty for a WP that plainly exists.
  function close() {
    setOpen(false);
    setQuery("");
  }

  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? wps
      : wps.filter((w) => w.code.toLowerCase().includes(q) || w.name.toLowerCase().includes(q));

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

      <BottomSheet open={open} title="เลือกงาน" onClose={close}>
        <div className="flex flex-col">
          {/* Sticky, not a plain child of the sheet's scroller — this is the
              ~178-row case U3 exists for, and a search box that scrolls out
              of view the moment the list is long enough to need it defeats
              the unit. Negates the scroller's own px-5/pt-4 to reclaim full
              width + true top:0, then restates them on itself. */}
          <div className="border-edge bg-card sticky top-0 z-10 -mx-5 -mt-4 border-b px-5 pt-4 pb-3">
            <div className="relative">
              <Search
                aria-hidden
                className="text-ink-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${FIELD_INPUT} pl-10`}
                placeholder={SEARCH_PLACEHOLDER}
                aria-label={SEARCH_PLACEHOLDER}
                autoComplete="off"
              />
            </div>
          </div>

          {matches.length > 0 ? (
            <ul className="flex flex-col gap-2 pt-3">
              {matches.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => {
                      router.push(photoTarget(w));
                      close();
                    }}
                    className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-control flex w-full items-center gap-2 border px-4 py-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2"
                  >
                    <span className="text-ink-secondary shrink-0 font-mono text-xs">
                      {highlight(w.code, q)}
                    </span>
                    <span className="text-ink truncate font-medium">{highlight(w.name, q)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-secondary px-1 pt-4 pb-4 text-sm">ไม่พบงานที่ค้นหา</p>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
