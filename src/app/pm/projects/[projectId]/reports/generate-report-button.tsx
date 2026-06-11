"use client";

// PM "Generate report" button. Calls the generateReport server action,
// surfaces pending state + a duplicate-guard message when refused, and
// triggers a router.refresh() on success so the new row appears in the
// list (the ReportsList client component then takes over polling). The
// server action is the load-bearing validator; this UI just gives fast
// feedback.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateReport } from "./actions";

interface GenerateReportButtonProps {
  projectId: string;
  initiallyDisabled: boolean;
}

export function GenerateReportButton({ projectId, initiallyDisabled }: GenerateReportButtonProps) {
  const router = useRouter();
  const [pending, startSubmit] = useTransition();
  const [reason, setReason] = useState<string | null>(
    initiallyDisabled ? "มีรายงานของโครงการนี้กำลังสร้างอยู่แล้ว" : null,
  );

  // Once the user actually clicks, the server action is authoritative.
  // initiallyDisabled is the server-rendered hint; clicking through it
  // (e.g. after polling drops the in-flight count to zero) is fine —
  // the action re-checks.
  function handleClick(): void {
    setReason(null);
    startSubmit(async () => {
      const result = await generateReport({ projectId });
      if (!result.ok) {
        setReason(result.reason);
        return;
      }
      router.refresh();
    });
  }

  const disabled = pending || (reason !== null && initiallyDisabled);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="inline-flex h-11 w-fit items-center justify-center rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
      >
        {pending ? "กำลังเข้าคิว…" : "สร้างรายงาน"}
      </button>
      {reason && (
        <p
          role="status"
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
        >
          {reason}
        </p>
      )}
    </div>
  );
}
