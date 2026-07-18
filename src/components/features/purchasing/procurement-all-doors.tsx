// Spec 327 U6c — the ทั้งหมด labeled door grid on หน้าหลัก. Once the section
// text grids retire, the icon chip rows are fast but icon-only; rule 4 (tiles
// are never the only path) demands a LABELED path to every door — this is it:
// a collapsed <details> holding the three STR groups as labeled icon rows.
// Same visibility judge (visibleDoors), same ?from threading, 📍 doors resolve
// via the selection and hide without one (§0). Server component.

import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { withBackFrom } from "@/lib/nav/back-href";
import {
  procurementDoorHref,
  visibleDoors,
  PROCUREMENT_STR_SECTIONS,
} from "@/lib/purchasing/procurement-home";

export function ProcurementAllDoors({
  isManager,
  activeProjectId,
  from,
}: {
  isManager: boolean;
  activeProjectId: string | null;
  from: string;
}) {
  return (
    <details className="rounded-card border-edge bg-card border px-4 py-3">
      <summary className="text-body text-ink-secondary flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
        <LayoutGrid aria-hidden className="size-5 shrink-0" />
        ทั้งหมด
      </summary>
      <div className="mt-2 flex flex-col gap-4">
        {PROCUREMENT_STR_SECTIONS.map((section) => {
          const doors = visibleDoors(section.doors, isManager, activeProjectId);
          if (doors.length === 0) return null;
          return (
            <div key={section.key} className="flex flex-col gap-2">
              <h3 className="text-meta text-ink-secondary font-semibold">{section.label}</h3>
              <div className="flex flex-col gap-1">
                {doors.map((door) => {
                  const Icon = door.icon;
                  return (
                    <Link
                      key={door.key}
                      href={withBackFrom(
                        procurementDoorHref(
                          door,
                          door.scope === "project" ? activeProjectId : null,
                        ),
                        from,
                      )}
                      className="text-ink hover:bg-sunk rounded-control flex min-h-11 items-center gap-3 px-2"
                    >
                      <Icon aria-hidden className="text-ink-secondary size-5 shrink-0" />
                      <span className="text-body min-w-0 flex-1 truncate">{door.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
