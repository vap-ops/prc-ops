"use client";

// Spec 226 / 207 U3c — WP work-category control. PM/super/director bind a work
// package to exactly one of its project's หมวดงาน (or clear it). A native
// select; choosing writes via setWorkPackageCategory (PM/super/director-only,
// membership-gated RPC) and toasts the result, optimistically updating +
// reverting on failure. The picker offers ACTIVE categories only, but renders an
// already-bound inactive category as the current value (categoryPickerOptions).
// A nudge shows while the WP is uncategorised. The parent renders this for
// managers only, alongside WpDeliverableControl.

import { useState, useTransition } from "react";
import { FIELD_SELECT } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { categoryPickerOptions, type WpCategoryOption } from "@/lib/work-packages/category-picker";
import { setWorkPackageCategory } from "@/app/projects/[projectId]/work-packages/[workPackageId]/category-actions";

interface WpCategoryControlProps {
  projectId: string;
  workPackageId: string;
  categoryId: string | null;
  categories: ReadonlyArray<WpCategoryOption>;
}

// The select's "uncategorised" sentinel — an empty value maps to a null binding.
const UNCATEGORISED = "";

export function WpCategoryControl({
  projectId,
  workPackageId,
  categoryId,
  categories,
}: WpCategoryControlProps) {
  const [current, setCurrent] = useState<string>(categoryId ?? UNCATEGORISED);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const options = categoryPickerOptions(categories, categoryId);

  function choose(next: string) {
    if (next === current || pending) return;
    const prev = current;
    setCurrent(next); // optimistic
    startTransition(async () => {
      const result = await setWorkPackageCategory({
        projectId,
        workPackageId,
        categoryId: next === UNCATEGORISED ? null : next,
      });
      toast.fromResult(result, "อัปเดตหมวดงานแล้ว");
      if (!result.ok) setCurrent(prev); // revert on failure
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="wp-category" className="text-meta text-ink-secondary font-semibold">
        หมวดงาน
      </label>
      <select
        id="wp-category"
        aria-label="หมวดงานของงาน"
        className={FIELD_SELECT}
        value={current}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
      >
        <option value={UNCATEGORISED}>ยังไม่ระบุหมวดงาน</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
      {current === UNCATEGORISED ? (
        <p className="text-meta text-ink-secondary">ยังไม่ได้เลือกหมวดงานให้งานนี้</p>
      ) : null}
    </div>
  );
}
