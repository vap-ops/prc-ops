"use client";

// Spec 155 / ADR 0059 — WP deliverable control. PM/super/director bind a work
// package to a งวดงาน (or ungroup it). A native select; choosing writes via
// setWorkPackageDeliverable (PM/super/director-only, membership-gated RPC) and
// toasts the result, optimistically updating + reverting on failure. The parent
// renders this for managers only.

import { useState, useTransition } from "react";
import { FIELD_SELECT } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { setWorkPackageDeliverable } from "@/app/projects/[projectId]/work-packages/[workPackageId]/deliverable-actions";

export interface DeliverableOption {
  id: string;
  code: string;
  name: string;
}

interface WpDeliverableControlProps {
  projectId: string;
  workPackageId: string;
  deliverableId: string | null;
  deliverables: ReadonlyArray<DeliverableOption>;
}

// The select's "ungrouped" sentinel — an empty value maps to a null binding.
const UNGROUPED = "";

export function WpDeliverableControl({
  projectId,
  workPackageId,
  deliverableId,
  deliverables,
}: WpDeliverableControlProps) {
  const [current, setCurrent] = useState<string>(deliverableId ?? UNGROUPED);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function choose(next: string) {
    if (next === current || pending) return;
    const prev = current;
    setCurrent(next); // optimistic
    startTransition(async () => {
      const result = await setWorkPackageDeliverable({
        projectId,
        workPackageId,
        deliverableId: next === UNGROUPED ? null : next,
      });
      toast.fromResult(result, "อัปเดตงวดงานแล้ว");
      if (!result.ok) setCurrent(prev); // revert on failure
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="wp-deliverable" className="text-meta text-ink-secondary font-semibold">
        งวดงาน
      </label>
      <select
        id="wp-deliverable"
        aria-label="งวดงานของงาน"
        className={FIELD_SELECT}
        value={current}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
      >
        <option value={UNGROUPED}>ยังไม่จัดกลุ่ม</option>
        {deliverables.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} · {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
