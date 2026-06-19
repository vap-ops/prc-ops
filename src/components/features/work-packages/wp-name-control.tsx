"use client";

// Spec 156 / ADR 0059 — WP name editor. PM/super/director rename a work package
// inline (single-line field + Save), writing via setWorkPackageName (PM/super/
// director-only, membership-gated RPC) and toasting the result. Sits in the
// manager-only management block beside priority / deliverable / schedule; the
// header keeps the read-only nameplate. The parent renders this for managers only.

import { useState, useTransition } from "react";
import { BUTTON_PRIMARY_COMPACT, FIELD_INPUT } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { setWorkPackageName } from "@/app/projects/[projectId]/work-packages/[workPackageId]/name-actions";

interface WpNameControlProps {
  projectId: string;
  workPackageId: string;
  name: string;
}

const MAX_NAME = 200;

export function WpNameControl({ projectId, workPackageId, name }: WpNameControlProps) {
  const [value, setValue] = useState<string>(name);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const trimmed = value.trim();
  const dirty = trimmed !== name && trimmed.length > 0 && trimmed.length <= MAX_NAME;

  function save() {
    if (!dirty || pending) return;
    startTransition(async () => {
      const result = await setWorkPackageName({ projectId, workPackageId, name: trimmed });
      toast.fromResult(result, "อัปเดตชื่องานแล้ว");
      if (result.ok) setValue(trimmed); // normalise the field to the saved value
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="wp-name" className="text-meta text-ink-secondary font-semibold">
        ชื่องาน
      </label>
      <div className="flex items-center gap-2">
        <input
          id="wp-name"
          aria-label="ชื่องาน"
          className={FIELD_INPUT}
          value={value}
          maxLength={MAX_NAME}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className={BUTTON_PRIMARY_COMPACT}
          disabled={!dirty || pending}
          onClick={save}
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
