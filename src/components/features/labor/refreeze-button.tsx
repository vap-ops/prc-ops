"use client";

// Spec 68 P2 — explicit PM re-freeze of a WP's labor cost snapshot. The
// auto-freeze runs at approve→complete; this lets a pm/super re-snapshot
// after a post-close labor correction (C6: the snapshot moves only on a
// deliberate, audited freeze). Re-freeze is recomputable + audited, so it
// is not "destructive" — a plain pending button, no ConfirmDialog (§7).
//
// 'use client' justified: pending state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreezeWpLaborCost } from "@/lib/labor/actions";
import { BUTTON_SECONDARY_COMPACT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface RefreezeButtonProps {
  workPackageId: string;
  revalidate: string;
  /** "ตรึงค่าแรง" before the first freeze, "ตรึงค่าแรงใหม่" after. */
  idleLabel: string;
}

export function RefreezeButton({ workPackageId, revalidate, idleLabel }: RefreezeButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={BUTTON_SECONDARY_COMPACT}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await refreezeWpLaborCost({ workPackageId, revalidate });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? "กำลังตรึง…" : idleLabel}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
