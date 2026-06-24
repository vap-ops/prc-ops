"use client";

// Spec 192 U4b — the /sa daily-action hero. The SA's daily loop is "log labour"
// and "add a photo"; this surfaces both at the top of the home so they aren't a
// scan-the-worklist-then-tap-a-chip step. With a SINGLE active WP each action is a
// direct link to that WP's labour / photo tab; with several it opens a quick
// เลือกงาน picker, then routes to the chosen WP's tab. No new capture — it reuses
// the WP-detail hash deep-links (#wp-labor / #wp-photos). 'use client': the picker
// sheet state + router navigation.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, HardHat } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY } from "@/lib/ui/classes";
import { workPackageHref } from "@/lib/nav/project-paths";

export type DailyHeroWp = { id: string; projectId: string; code: string; name: string };

const LABOR_HASH = "#wp-labor";
const PHOTO_HASH = "#wp-photos";

const ACTIONS = [
  { hash: LABOR_HASH, label: "ลงเวลาวันนี้", Icon: HardHat },
  { hash: PHOTO_HASH, label: "เพิ่มรูปวันนี้", Icon: Camera },
] as const;

export function DailyHero({ wps }: { wps: DailyHeroWp[] }) {
  const router = useRouter();
  // Which action's picker is open (its target hash), or null when closed.
  const [pickHash, setPickHash] = useState<string | null>(null);

  if (wps.length === 0) return null;
  const single = wps.length === 1 ? wps[0]! : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {ACTIONS.map(({ hash, label, Icon }) =>
          single ? (
            <Link
              key={hash}
              href={`${workPackageHref(single.projectId, single.id)}${hash}`}
              className={`${BUTTON_PRIMARY} flex-1 gap-2`}
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              {label}
            </Link>
          ) : (
            <button
              key={hash}
              type="button"
              onClick={() => setPickHash(hash)}
              className={`${BUTTON_PRIMARY} flex-1 gap-2`}
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              {label}
            </button>
          ),
        )}
      </div>

      <BottomSheet open={pickHash !== null} title="เลือกงาน" onClose={() => setPickHash(null)}>
        <ul className="flex flex-col gap-2">
          {wps.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => {
                  if (pickHash) router.push(`${workPackageHref(w.projectId, w.id)}${pickHash}`);
                  setPickHash(null);
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
    </div>
  );
}
