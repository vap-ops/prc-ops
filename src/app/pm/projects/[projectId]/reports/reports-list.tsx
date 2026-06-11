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
import { EmptyNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { REPORT_STATUS_LABEL, isReportInFlight, type ReportStatus } from "@/lib/reports/predicates";
import { reportStatusPillClasses } from "@/lib/status-colors";
import { formatThaiDateTime } from "@/lib/i18n/labels";
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
    <li className="rounded-md border border-zinc-300 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <StatusPill pillClasses={reportStatusPillClasses(report.status)}>
          {REPORT_STATUS_LABEL[report.status]}
        </StatusPill>
        <span className="text-xs text-zinc-600">{formatThaiDateTime(report.createdAt)}</span>
      </div>
      {report.status === "complete" && <DownloadButton reportId={report.id} />}
      {report.status === "failed" && report.error && (
        <p className="mt-2 text-xs whitespace-pre-wrap text-red-800">{report.error}</p>
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
      // Open the signed URL in a new tab. Mobile browsers treat this
      // as a download for application/pdf; desktop opens the PDF
      // in-tab via the platform PDF viewer. Either is acceptable for
      // the v1 PM flow.
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex h-11 w-fit items-center justify-center rounded-md border border-zinc-400 bg-white px-3 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-100 disabled:text-zinc-500"
      >
        {pending ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลด PDF"}
      </button>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
        >
          {error}
        </p>
      )}
    </div>
  );
}
