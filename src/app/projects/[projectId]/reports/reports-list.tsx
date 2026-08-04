"use client";

// PM reports list: per-report status pill + Download (when complete) or
// error text (when failed). Auto-polls while any report on the page is
// in-flight (status requested or processing) and STOPS polling as soon
// as every report is terminal.
//
// Poll approach: a single setInterval in this client component that
// calls router.refresh() every POLL_INTERVAL_MS while any visible
// report is in-flight. router.refresh() re-renders the server
// component, which re-fetches `reports` rows under the user's RLS —
// so the worker's status flips (requested → processing → complete |
// failed) reach the screen without a manual reload. The interval is
// cleared as soon as the server snapshot shows no in-flight rows, and
// always cleared on unmount. The Railway cron interval is ~5 minutes
// for the worker, so we poll at 12s to surface state changes within
// one screen-look but not spam the server with renders.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { REPORT_STATUS_LABEL, isReportInFlight, type ReportStatus } from "@/lib/reports/predicates";
import { reportStatusPillClasses } from "@/lib/status-colors";
import { reportStatusIcon } from "@/lib/status-icons";
import { formatThaiDateTime } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";
import { getReportDownloadUrl } from "./actions";

const POLL_INTERVAL_MS = 12_000;

export interface ReportListItem {
  id: string;
  status: ReportStatus;
  storagePath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReportsListProps {
  reports: ReportListItem[];
}

export function ReportsList({ reports }: ReportsListProps) {
  const router = useRouter();
  const anyInFlight = reports.some((r) => isReportInFlight(r.status));

  useEffect(() => {
    if (!anyInFlight) return;
    const id = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [anyInFlight, router]);

  if (reports.length === 0) {
    return <EmptyNotice>ยังไม่มีรายงาน</EmptyNotice>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {reports.map((r) => (
        <ReportRow key={r.id} report={r} />
      ))}
    </ul>
  );
}

function ReportRow({ report }: { report: ReportListItem }) {
  return (
    <li className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <StatusPill
          pillClasses={reportStatusPillClasses(report.status)}
          icon={reportStatusIcon(report.status)}
        >
          {REPORT_STATUS_LABEL[report.status]}
        </StatusPill>
        <span className="text-ink-secondary text-xs">{formatThaiDateTime(report.createdAt)}</span>
      </div>
      {report.status === "complete" && <DownloadButton reportId={report.id} />}
      {report.status === "failed" && report.error && (
        <p className="text-danger mt-2 text-xs whitespace-pre-wrap">{report.error}</p>
      )}
    </li>
  );
}

function DownloadButton({ reportId }: { reportId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick(): void {
    setError(null);
    startTransition(async () => {
      const result = await getReportDownloadUrl({ reportId });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      // Spec 60: NO window.open — the spec-45 lesson: the installed PWA
      // has no tab model, and iOS transient activation is spent after
      // the await above. Fetch the bytes and hand them over in-page:
      // share sheet on devices that take files (iOS PWA — Save to
      // Files / LINE / AirDrop), object-URL anchor download elsewhere.
      try {
        const resp = await fetch(result.url);
        if (!resp.ok) throw new Error(`download fetch ${resp.status}`);
        const blob = await resp.blob();
        const file = new File([blob], result.fileName, { type: "application/pdf" });
        if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
          } catch (shareErr) {
            // User closed the sheet — not an error.
            if (shareErr instanceof DOMException && shareErr.name === "AbortError") return;
            throw shareErr;
          }
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = result.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        console.error("[reports] download failed", e);
        setError("ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-control border-edge-strong bg-card text-ink hover:bg-sunk focus-visible:ring-action disabled:border-edge-strong disabled:bg-sunk disabled:text-ink-muted inline-flex h-11 w-fit items-center justify-center border px-3 text-xs font-medium shadow-xs transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
      >
        {pending ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลด PDF"}
      </button>
      {error && (
        <p
          role="alert"
          className="border-danger-edge bg-danger-soft text-danger-ink rounded-md border px-2 py-1 text-xs"
        >
          {error}
        </p>
      )}
    </div>
  );
}
