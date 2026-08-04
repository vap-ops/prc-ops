"use client";

// Spec 392 U2a — remove a zone from the list. Deleting a zone does NOT delete
// the work packages in it: `work_packages.zone_id` is `on delete set null`, so
// they return to "no zone". The confirm copy says exactly that, because the
// alternative reading (the work disappears with the area) is the one a site
// manager would fear.

import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { deleteZone } from "./actions";

export function DeleteZoneButton({
  projectId,
  zoneId,
  zoneName,
  workPackageCount,
}: {
  projectId: string;
  zoneId: string;
  zoneName: string;
  workPackageCount: number;
}) {
  const consequence =
    workPackageCount > 0
      ? `งาน ${workPackageCount} รายการจะกลับไปเป็นยังไม่ระบุโซน (ไม่ถูกลบ)`
      : "ยังไม่มีงานอยู่ในโซนนี้";

  return (
    <ConfirmActionButton
      idleLabel="ลบ"
      pendingLabel="กำลังลบ…"
      confirmMessage={`ลบโซน ${zoneName}? ${consequence}`}
      confirmLabel="ลบโซน"
      buttonClassName="text-danger focus-visible:ring-action shrink-0 rounded px-2 py-1 text-meta font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
      action={() => deleteZone({ projectId, zoneId })}
    />
  );
}
