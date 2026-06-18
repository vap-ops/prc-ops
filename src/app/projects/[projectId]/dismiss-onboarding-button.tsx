"use client";

// Spec 142 U3 — the checklist's "hide" control. 'use client' justified: pending
// state + client-side refresh after the dismiss action persists.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissProjectOnboarding } from "./actions";

export function DismissOnboardingButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await dismissProjectOnboarding(projectId);
          if (result.ok) router.refresh();
        })
      }
      className="text-ink-muted hover:text-ink shrink-0 text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50"
    >
      {pending ? "กำลังซ่อน…" : "ซ่อนเช็กลิสต์"}
    </button>
  );
}
