"use client";

// PM on-hold toggle (spec 52 part B). 'use client' justified: submit
// pending state via useTransition + inline error surface. The server
// action (setHoldStatus) is the load-bearing validator; this button
// only renders for statuses the action would accept.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { canHold, canRelease, type WorkPackageStatus } from "@/lib/work-packages/hold";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { setHoldStatus } from "./actions";

interface HoldToggleProps {
  workPackageId: string;
  status: WorkPackageStatus;
}

export function HoldToggle({ workPackageId, status }: HoldToggleProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const holdable = canHold(status);
  const releasable = canRelease(status);
  if (!holdable && !releasable) return null;

  function handleClick() {
    setError(null);
    startSubmit(async () => {
      const result = await setHoldStatus({ workPackageId, hold: holdable });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {holdable ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={submitting}
          className={BUTTON_SECONDARY}
        >
          {submitting ? "กำลังบันทึก…" : "พักงานชั่วคราว"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={submitting}
          className={BUTTON_PRIMARY}
        >
          {submitting ? "กำลังบันทึก…" : "กลับมาดำเนินการ"}
        </button>
      )}
      {error && (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      )}
    </div>
  );
}
