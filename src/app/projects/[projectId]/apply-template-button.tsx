"use client";

// Spec 142 U5 — apply the project_type's WP template. 'use client' justified:
// pending state, inline error, router.refresh to surface the seeded WPs. Shown
// only when a template exists for the project's type (page decides). Idempotent
// (the RPC skips codes already present), so a re-tap is safe.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyWpTemplate } from "./actions";

export function ApplyTemplateButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await applyWpTemplate(projectId);
            if (result.ok) {
              router.refresh();
              return;
            }
            setError(result.error);
          });
        }}
        className="border-edge-strong text-ink hover:bg-sunk focus-visible:ring-action rounded-control bg-card text-body inline-flex h-11 items-center border px-4 font-medium transition-colors focus:outline-none focus-visible:ring-2 active:translate-y-px disabled:opacity-50"
      >
        {pending ? "กำลังเพิ่ม…" : "ใช้เทมเพลตงาน"}
      </button>
      {error && (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      )}
    </>
  );
}
