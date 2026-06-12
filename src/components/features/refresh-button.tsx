"use client";

// Refresh button (spec 53). The installed PWA has no browser chrome, so
// this is the app's only reload affordance. 'use client' justified:
// onClick + useTransition spinner state. router.refresh() re-fetches
// the route's server components without dropping client state (lightbox,
// drafts, the offline-queue banner) — deliberately NOT a hard reload.

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RotateCw } from "lucide-react";

interface RefreshButtonProps {
  /** dark = slate-900 brand band (AppHeader); light = white detail headers. */
  variant: "dark" | "light";
}

const VARIANT_CLASSES: Record<RefreshButtonProps["variant"], string> = {
  dark: "text-slate-100 hover:bg-slate-800 hover:text-amber-300 focus-visible:ring-amber-300",
  light: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-blue-700",
};

export function RefreshButton({ variant }: RefreshButtonProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <button
      type="button"
      aria-label="รีเฟรช"
      disabled={refreshing}
      onClick={() => {
        startRefresh(() => {
          router.refresh();
        });
      }}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]}`}
    >
      <RotateCw aria-hidden="true" className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
    </button>
  );
}
