"use client";

// WP priority control (spec 91 follow-up) — PM/super set a work package's
// urgency, which drives the worklist ด่วน tag + ต้องทำ sort. Three chips;
// tapping writes via setWorkPackagePriority (PM/super-only RPC) and toasts
// the result, optimistically updating and reverting on failure. The parent
// renders this for PM/super only.

import { useState, useTransition } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { useToast } from "@/lib/ui/use-toast";
import { setWorkPackagePriority } from "@/app/projects/[projectId]/work-packages/[workPackageId]/priority-actions";
import type { WpPriority } from "@/lib/work-packages/action-bands";

const OPTIONS: ReadonlyArray<{ value: WpPriority; label: string }> = [
  { value: "normal", label: "ปกติ" },
  { value: "urgent", label: "ด่วน" },
  { value: "critical", label: "ด่วนมาก" },
];

interface WpPriorityControlProps {
  projectId: string;
  workPackageId: string;
  priority: WpPriority;
}

export function WpPriorityControl({ projectId, workPackageId, priority }: WpPriorityControlProps) {
  const [current, setCurrent] = useState<WpPriority>(priority);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function choose(next: WpPriority) {
    if (next === current || pending) return;
    const prev = current;
    setCurrent(next); // optimistic
    startTransition(async () => {
      const result = await setWorkPackagePriority({ projectId, workPackageId, priority: next });
      toast.fromResult(result, "อัปเดตความสำคัญแล้ว");
      if (!result.ok) setCurrent(prev); // revert on failure
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-meta text-ink-secondary font-semibold">ความสำคัญ</p>
      {/* flex-wrap: RadioChips are unwrappable by contract (#235 guard). */}
      <div role="radiogroup" aria-label="ความสำคัญของงาน" className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <RadioChip
            key={o.value}
            name="wp-priority"
            label={o.label}
            checked={current === o.value}
            onSelect={() => choose(o.value)}
          />
        ))}
      </div>
    </div>
  );
}
