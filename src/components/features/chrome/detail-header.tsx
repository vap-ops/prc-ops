// DetailHeader (spec 63): THE sticky detail-header shell — back chip,
// refresh, optional action chips, the nameplate block as children.
// Field-First: token-rewired (border-edge / bg-card), structure +
// behavior unchanged. The nameplate (children) carries the WP/subject
// identity at the display tier — see DETAIL_TITLE.
// Server component; only RefreshButton inside is client.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { ICON_CHIP } from "@/lib/ui/classes";
import { RefreshButton } from "@/components/features/common/refresh-button";

interface DetailHeaderProps {
  backHref: string;
  backLabel: string;
  /** Extra header chips (gear, reports, …) rendered left of refresh. */
  actions?: React.ReactNode;
  /** The nameplate block: code line, h1, meta lines. */
  children: React.ReactNode;
}

export function DetailHeader({ backHref, backLabel, actions, children }: DetailHeaderProps) {
  return (
    // Spec 62 z-stack: headers 20 < queue banner 30 < tab bar 40 < scrims 50.
    <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
        <div className="flex items-center justify-between gap-3">
          <Link href={backHref} aria-label={backLabel} className={ICON_CHIP}>
            <ArrowLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
            {/* Spec 53: the PWA's only reload affordance. */}
            <RefreshButton variant="light" />
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}
