"use client";

// PM on-hold toggle (spec 52 part B). 'use client' justified: submit
// pending state via useTransition + inline error surface. The server
// action (setHoldStatus) is the load-bearing validator; this button
// only renders for statuses the action would accept.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { canHold, canRelease, type WorkPackageStatus } from "@/lib/work-packages/hold";
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
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-xs transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-zinc-500"
        >
          {submitting ? "กำลังบันทึก…" : "พักงานชั่วคราว"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={submitting}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {submitting ? "กำลังบันทึก…" : "กลับมาดำเนินการ"}
        </button>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          {error}
        </div>
      )}
    </div>
  );
}
