"use client";

// Spec 189 U2 — create a new draft supply plan, then navigate to it. 'use client'
// is required: the button needs an onClick handler + router navigation to the
// freshly-created plan (?plan=<id>).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { createPlan } from "@/app/projects/[projectId]/supply-plan/actions";

export function NewPlanButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    setError(null);
    start(async () => {
      const result = await createPlan({ projectId });
      if (!result.ok || !result.planId) {
        setError(result.ok ? "สร้างแผนไม่สำเร็จ" : result.error);
        return;
      }
      router.push(`?plan=${result.planId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className={`${BUTTON_PRIMARY} inline-flex items-center gap-1`}
      >
        <Plus aria-hidden className="size-4" /> {pending ? "กำลังสร้าง…" : "สร้างแผนใหม่"}
      </button>
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
