// Spec 392 U3a — the work package's zone, shown on the WP detail beside the
// code line (spec 392 §5). Pure display, server-safe (no hooks, no state).
//
// TWO gates, and they are not the same gate:
//
//  1. WHETHER THE ZONE IS SHOWN AT ALL is decided by the DATA, not by a role
//     list. `project_zones` SELECT is `procurement/procurement_manager OR
//     can_see_project`, and `can_see_project` is live-FALSE for `technician` on
//     every arm — so the page reads the zone THROUGH RLS and passes `null` when
//     nothing came back. A chip built from `zone_id` alone would name a zone
//     the reader may not have; a chip rendered as a permanent placeholder would
//     be the affordance-then-refuse defect. `null` in, nothing out.
//
//  2. WHETHER IT IS A DOOR is narrower still. `/projects/:id/zones` is
//     `requireRole(PM_ROLES)`, which REDIRECTS everyone else to their role
//     home — so a site_admin who can read the zone still cannot open the map.
//     For them `href` is null and the chip states the zone without offering a
//     link that would bounce them off the page they are standing on.
//
// The caller owns `?from`: the zones route now has two parents (the project
// header chip and this one), so its back chip resolves through safeBackHref and
// an un-threaded link would eject the reader to the project instead of back to
// this work package.

import Link from "next/link";
import { MapPin } from "lucide-react";
import { ZONE_LABEL, ZONE_MAP_LABEL } from "@/lib/i18n/labels";

export interface WpZoneChipZone {
  code: string;
  name: string;
}

// text-ink-secondary, never text-ink-muted: this is readable copy, and the
// design-doctrine ratchet counts every new muted use (globals.css:87 reserves
// muted for dividers / placeholder / disabled).
const SHELL =
  "border-edge bg-sunk text-meta inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5";

export function WpZoneChip({
  zone,
  href,
}: {
  /** null = the WP has no zone, OR its zone row was withheld by RLS. */
  zone: WpZoneChipZone | null;
  /** null = this viewer cannot open the zone map; the chip renders inert. */
  href: string | null;
}) {
  if (!zone) return null;

  const body = (
    <>
      <MapPin aria-hidden className="text-ink-secondary size-3.5 shrink-0" />
      <span className="text-ink-secondary">{ZONE_LABEL}</span>
      <span className="text-ink-secondary font-mono">{zone.code}</span>
      <span className="text-ink truncate font-medium">{zone.name}</span>
    </>
  );

  if (!href) return <span className={SHELL}>{body}</span>;

  return (
    // The 44px floor is on the ANCHOR, not on the pill. SHELL's geometry came
    // from WorkCategoryBadge, which is a non-interactive <span>; borrowing it
    // for a link would have shipped a ~22px tap target on a gloved-hand PWA,
    // sitting a gap-1.5 away from that very badge. The design-doctrine tap
    // ratchet scans <button> tags only, so nothing would have caught it.
    <Link
      href={href}
      // The visible text names a zone; only the label says that following this
      // reaches the map. A door whose accessible name is just its subject reads
      // as a label to a screen reader.
      aria-label={`${ZONE_MAP_LABEL} — ${zone.code} ${zone.name}`}
      className="focus-visible:ring-action inline-flex min-h-11 max-w-full items-center rounded-full focus:outline-none focus-visible:ring-2"
    >
      <span className={`${SHELL} hover:brightness-[0.98]`}>{body}</span>
    </Link>
  );
}
