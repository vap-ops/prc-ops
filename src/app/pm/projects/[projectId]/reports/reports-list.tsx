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
import { REPORT_STATUS_LABEL, isReportInFlight, type ReportStatus } from "@/lib/reports/predicates";
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

const STATUS_PILL_CLASSES: Record<ReportStatus, string> = {
  requested: "border-zinc-700 bg-zinc-800 text-zinc-300",
  processing: "border-amber-900/60 bg-amber-950/40 text-amber-200",
  complete: "border-emerald-900/60 bg-emerald-950/40 text-emerald-200",
  failed: "border-red-900/60 bg-red-950/40 text-red-200",
};

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
    return (
      <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400">
        No reports yet.
      </p>
    );
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
    <li className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[report.status]}`}
        >
          {REPORT_STATUS_LABEL[report.status]}
        </span>
        <span className="text-xs text-zinc-500">{formatDateTime(report.createdAt)}</span>
      </div>
      {report.status === "complete" && <DownloadButton reportId={report.id} />}
      {report.status === "failed" && report.error && (
        <p className="mt-2 text-xs whitespace-pre-wrap text-red-300/80">{report.error}</p>
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
        className="inline-flex h-8 w-fit items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Preparing…" : "Download PDF"}
      </button>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs text-red-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
