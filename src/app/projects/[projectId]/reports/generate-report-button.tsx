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
  /** Spec 394 U3 — how many photos this project's PD has picked for the client
   *  report. Drives the 4th option's live count, and disables it at zero. */
  selectedPhotoCount: number;
}

export function GenerateReportButton({
  projectId,
  initiallyDisabled,
  selectedPhotoCount,
}: GenerateReportButtonProps) {
  const router = useRouter();
  const [pending, startSubmit] = useTransition();
  const [params, setParams] = useState<ReportParams>(DEFAULT_REPORT_PARAMS);
  const [coverNote, setCoverNote] = useState("");
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
        // Spec 394 D7 — omit the key when blank rather than sending "".
        const note = coverNote.trim();
        const chosen: ReportParams = { ...params, photos: effectivePhotos };
        const result = await generateReport({
          projectId,
          params: note ? { ...chosen, coverNote: note } : chosen,
        });
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

  // The reports list refreshes, so `selectedPhotoCount` can drop to zero (a PD
  // unselects elsewhere) while "selected" is the chosen mode. Derive ONE
  // effective mode and use it for both the chips and the payload, so the user
  // never sits in a state they cannot leave and the form never sends a mode the
  // server is about to refuse. This is visible, not a silent fallback: the
  // default chip becomes the checked one on screen.
  const effectivePhotos: ReportPhotosMode =
    params.photos === "selected" && selectedPhotoCount === 0
      ? DEFAULT_REPORT_PARAMS.photos
      : params.photos;

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
                checked={effectivePhotos === opt.value}
                onSelect={() => setParams((p) => ({ ...p, photos: opt.value }))}
              />
            ))}
            {/* Spec 394 U3 — the 4th mode. Rendered even at zero, DISABLED:
                hiding it means a PD who has never picked a photo can never
                learn the mode exists. The label carries the reason, because
                the disabled attribute alone announces "unavailable" without
                saying why. */}
            <RadioChip
              name="report-photos"
              label={
                selectedPhotoCount > 0
                  ? `เฉพาะที่เลือก (${selectedPhotoCount} รูป)`
                  : "เฉพาะที่เลือก — ยังไม่ได้เลือกรูป"
              }
              // Never `checked` while disabled: the reports list refreshes, so
              // the count can drop to zero (another PD unselects) while this
              // chip is the chosen one — leaving a state the user cannot leave
              // except by picking a different chip, whose submit then bounces
              // off the server guard.
              checked={effectivePhotos === "selected"}
              disabled={selectedPhotoCount === 0}
              onSelect={() => setParams((p) => ({ ...p, photos: "selected" }))}
            />
          </div>
        </fieldset>
        {/* Spec 394 D7 — often the first thing a client reads. One field, no
            per-photo labour; it rides the report's params jsonb so it is frozen
            with the document that was actually sent. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-cover-note" className="text-ink text-sm font-medium">
            คำนำถึงลูกค้า (ไม่บังคับ)
          </label>
          <textarea
            id="report-cover-note"
            value={coverNote}
            onChange={(e) => setCoverNote(e.target.value)}
            disabled={pending}
            rows={3}
            className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
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
