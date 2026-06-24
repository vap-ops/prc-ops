"use client";

// Spec 189 follow-up — delete a draft/rejected supply plan from the plan list.
// Thin wrapper over ConfirmActionButton (themed confirm dialog, §7 no
// window.confirm) bound to the deletePlan action; success refreshes (the deleted
// plan's ?plan param then resolves to nothing, so the list shows).

import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { deletePlan } from "@/app/projects/[projectId]/supply-plan/actions";

export function DeletePlanButton({ projectId, planId }: { projectId: string; planId: string }) {
  return (
    <ConfirmActionButton
      idleLabel="ลบ"
      pendingLabel="กำลังลบ…"
      confirmMessage="ลบแผนจัดหานี้? รายการวัสดุในแผนจะถูกลบทั้งหมด"
      confirmLabel="ลบแผน"
      buttonClassName="text-danger focus-visible:ring-action shrink-0 rounded px-2 py-1 text-meta font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
      action={() => deletePlan({ projectId, planId })}
    />
  );
}
