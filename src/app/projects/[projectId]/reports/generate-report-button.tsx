"use client";

import { BUTTON_PRIMARY } from "@/lib/ui/classes";

// PM "Generate report" controls (spec 61): two radio groups choose what
// the report includes, then the button calls the generateReport server
// action. Defaults reproduce the legacy report. Pending state + the
// duplicate-guard message surface here; the server action is the
// load-bearing validator.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  DEFAULT_REPORT_PARAMS,
  type ReportParams,
  type ReportPhotosMode,
  type ReportScope,
} from "@/lib/reports/params";
import { generateReport } from "./actions";

const SCOPE_OPTIONS: ReadonlyArray<{ value: ReportScope; label: string }> = [
  { value: "complete", label: "เฉพาะงานเสร็จสิ้น" },
  { value: "all", label: "ทุกงาน (แสดงสถานะ)" },
];

const PHOTO_OPTIONS: ReadonlyArray<{ value: ReportPhotosMode; label: string }> = [
  { value: "after", label: "รูปช่วงแล้วเสร็จ" },
  { value: "all_phases", label: "รูปทุกช่วง" },
  { value: "none", label: "ไม่ใส่รูป" },
];

interface GenerateReportButtonProps {
  projectId: string;
  initiallyDisabled: boolean;
}

export function GenerateReportButton({ projectId, initiallyDisabled }: GenerateReportButtonProps) {
  const router = useRouter();
  const [pending, startSubmit] = useTransition();
  const [params, setParams] = useState<ReportParams>(DEFAULT_REPORT_PARAMS);
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
      // The action BUILDS the PDF in-request (spec 39) — a platform
      // timeout on a photo-heavy project rejects here; the reaper/sweeper
      // recover server-side, so degrade softly instead of error.tsx.
      try {
        const result = await generateReport({ projectId, params });
        if (!result.ok) {
          setReason(result.reason);
          return;
        }
      } catch {
        setReason("ระบบกำลังสร้างรายงานอยู่ — รีเฟรชหน้านี้ในอีกสักครู่");
      }
      router.refresh();
    });
  }

  const disabled = pending || (reason !== null && initiallyDisabled);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-card border-edge bg-card shadow-card flex flex-col gap-3 border p-4">
        <fieldset className="flex flex-col gap-1.5" disabled={pending}>
          <legend className="text-ink mb-1 text-sm font-medium">งานที่รวมในรายงาน</legend>
          <div className="flex flex-wrap gap-2">
            {SCOPE_OPTIONS.map((opt) => (
              <RadioChip
                key={opt.value}
                name="report-scope"
                label={opt.label}
                checked={params.scope === opt.value}
                onSelect={() => setParams((p) => ({ ...p, scope: opt.value }))}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5" disabled={pending}>
          <legend className="text-ink mb-1 text-sm font-medium">รูปถ่าย</legend>
          <div className="flex flex-wrap gap-2">
            {PHOTO_OPTIONS.map((opt) => (
              <RadioChip
                key={opt.value}
                name="report-photos"
                label={opt.label}
                checked={params.photos === opt.value}
                onSelect={() => setParams((p) => ({ ...p, photos: opt.value }))}
              />
            ))}
          </div>
        </fieldset>
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`${BUTTON_PRIMARY} w-fit`}
      >
        {pending ? "กำลังสร้าง…" : "สร้างรายงาน"}
      </button>
      {reason && (
        <p
          role="status"
          className="rounded-control border-edge bg-page text-ink-secondary border px-3 py-2 text-xs"
        >
          {reason}
        </p>
      )}
    </div>
  );
}
