// Spec 327 U6 — the icon chip row: doors as 44px icon-only chips ON TOP of the
// procurement surfaces (the project-page ICON_CHIP idiom users picked at
// checkpoint 2, replacing the text door grids). The door label IS the
// accessible name (aria-label — SSOT constants); hrefs thread ?from back to
// the hosting surface; 📍 project doors render only with a project resolved;
// managerOnly doors render for the manager tier only (visibleProcurementDoors
// stays the single visibility judge). Server component.

import Link from "next/link";

import { withBackFrom } from "@/lib/nav/back-href";
import {
  procurementDoorHref,
  visibleDoors,
  type ProcurementDoor,
} from "@/lib/purchasing/procurement-home";
import { ICON_CHIP_MUTED } from "@/lib/ui/classes";

export function ProcurementDoorChips({
  doors,
  isManager,
  activeProjectId,
  from,
}: {
  doors: ReadonlyArray<ProcurementDoor>;
  isManager: boolean;
  /** The resolved project for 📍 doors (effectiveDoorProjectId upstream). */
  activeProjectId: string | null;
  /** The hosting surface's pathname — threaded as the back referrer. */
  from: string;
}) {
  const visible = visibleDoors(doors, isManager, activeProjectId);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((door) => {
        const Icon = door.icon;
        return (
          <Link
            key={door.key}
            href={withBackFrom(
              procurementDoorHref(door, door.scope === "project" ? activeProjectId : null),
              from,
            )}
            aria-label={door.label}
            title={door.label}
            className={ICON_CHIP_MUTED}
          >
            <Icon aria-hidden className="h-5 w-5" />
          </Link>
        );
      })}
    </div>
  );
}
