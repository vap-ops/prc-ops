"use client";

// Spec 245 U2 — clone a global ordering-plan template into a fresh draft plan
// for this project, then navigate to it (mirrors NewPlanButton's ?plan=<id>
// pattern). 'use client' is required: local select-state + router navigation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { cloneSupplyPlanTemplate } from "@/app/projects/[projectId]/supply-plan/actions";

export type TemplatePick = { id: string; name: string };

export function CloneTemplateButton({
  projectId,
  templates,
}: {
  projectId: string;
  templates: TemplatePick[];
}) {
  const router = useRouter();
  const firstId = templates[0]?.id ?? "";
  const [templateId, setTemplateId] = useState(firstId);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (templates.length === 0) return null;

  function handle() {
    setError(null);
    start(async () => {
      const result = await cloneSupplyPlanTemplate({ templateId, projectId });
      if (!result.ok || !result.planId) {
        setError(result.ok ? "สร้างแผนจากเทมเพลตไม่สำเร็จ" : result.error);
        return;
      }
      router.push(`?plan=${result.planId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="rounded-control border-edge bg-card text-ink text-body border px-3 py-2"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handle}
          disabled={pending}
          className={`${BUTTON_SECONDARY} inline-flex items-center gap-1`}
        >
          <Copy aria-hidden className="size-4" /> {pending ? "กำลังสร้าง…" : "ใช้เทมเพลตนี้"}
        </button>
      </div>
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
