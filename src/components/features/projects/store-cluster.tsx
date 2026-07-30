// Spec 376 U2 — the `คลังหน้างาน` cluster on the project hub. Two labeled store
// doors, ของเข้า first (the higher-traffic one: 153 views vs the store page's 11
// over 14d).
//
// ⚠️ ONE door per destination per surface (spec 313 U3). This REPLACED the two icon
// chips in the DetailHeader — re-adding either is the duplicate-door defect.
// ⚠️ Destinations, not actions: เบิก stays on `/sa` (the spec 375 U3 custody pair)
// and นับสต็อก is a console inside the คลัง page, so neither earns a tile here.
// ⚠️ D1 forward-compat (spec 376 §2): holds NO role knowledge — the caller gates on
// `canSeeStore`, so a future `storekeeper` role is a role-set add, not a rework.
//
// Server component: two pure Links. Tile pattern from the spec 375 U3 custody pair.

import Link from "next/link";
import { ChevronRight, Truck, Warehouse } from "lucide-react";

import { incomingHref, storeHref } from "@/lib/nav/project-paths";
import { STORE_CLUSTER_HEADING, STORE_INCOMING_HEADING, STORE_LABEL } from "@/lib/i18n/labels";

// min-h-11 = the 44px gloved-hands tap floor (hard floor, ui-conventions §10).
const DOOR =
  "rounded-control focus-visible:ring-action hover:bg-sunk flex min-h-11 flex-1 items-center gap-2.5 px-3 py-3 transition-colors focus:outline-none focus-visible:ring-2";

export function StoreCluster({ projectId }: { projectId: string }) {
  return (
    <section className="mb-4 flex flex-col gap-3">
      <h2 className="text-meta text-ink-secondary font-semibold">{STORE_CLUSTER_HEADING}</h2>
      {/* One bordered container, split down the middle — the container is what
          makes the two read as a pair rather than as two adjacent tiles. */}
      <div className="rounded-card border-edge bg-card shadow-card flex items-stretch border p-1">
        <Link href={incomingHref(projectId)} className={DOOR}>
          <Truck aria-hidden className="text-ink size-6 shrink-0" />
          <span className="text-body text-ink min-w-0 flex-1 font-semibold">
            {STORE_INCOMING_HEADING}
          </span>
          <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
        </Link>
        <span aria-hidden className="bg-edge my-2 w-px shrink-0" />
        <Link href={storeHref(projectId)} className={DOOR}>
          <Warehouse aria-hidden className="text-ink size-6 shrink-0" />
          <span className="text-body text-ink min-w-0 flex-1 font-semibold">{STORE_LABEL}</span>
          <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
        </Link>
      </div>
    </section>
  );
}
