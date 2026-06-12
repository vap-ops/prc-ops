import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { ErrorNotice } from "@/components/features/notices";
import { RefreshButton } from "@/components/features/refresh-button";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { canGenerateReport, type ReportStatus } from "@/lib/reports/predicates";
import { GenerateReportButton } from "./generate-report-button";
import { ReportsList, type ReportListItem } from "./reports-list";

// PM report surface for a single project: the Generate button, the
// list of this project's reports (newest first, with status pill +
// Download when complete), and the auto-poll wiring (a client
// component re-fetches via router.refresh() while any report is
// in-flight).
//
// The Server Component renders the initial state; the client
// components own the interactivity. The duplicate guard is computed
// here (server side) so the Generate button starts disabled when a
// report is already in flight — the server action re-checks for
// authorisation.

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "รายงาน" };

// Spec 39: the generate action builds the PDF in-request (photo downloads
// + PDFKit) — needs more than the default function duration. The cron
// sweeper/reaper recover anything that still exceeds this.
export const maxDuration = 60;

export default async function ProjectReportsPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    notFound();
  }

  const { data: rows, error: reportsError } = await supabase
    .from("reports")
    .select("id, status, storage_path, error, created_at, updated_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });

  const reports: ReportListItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    status: r.status as ReportStatus,
    storagePath: r.storage_path,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const statuses: ReportStatus[] = reports.map((r) => r.status);
  const canGenerate = canGenerateReport(statuses);

  return (
    <main className="min-h-screen bg-zinc-50 pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      {/* Spec 60: detail header (spec-54 shape) replaces the hub
          AppHeader + link row — this is a project-scoped surface
          entered from the project page's รายงาน chip (spec 59). */}
      <header className="border-b border-zinc-200 bg-white px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/sa/projects/${project.id}`}
              aria-label="กลับไปหน้าโครงการ"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <ArrowLeft aria-hidden className="h-5 w-5" />
            </Link>
            {/* Spec 53: the PWA's only reload affordance. */}
            <RefreshButton variant="light" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-600">{project.code}</p>
            <h1 className="text-2xl font-bold tracking-tight break-words">รายงาน</h1>
            <p className="mt-0.5 text-xs text-zinc-600">{project.name}</p>
          </div>
        </div>
      </header>

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <section>
          <p className="mb-3 text-sm text-zinc-600">
            สร้างรายงาน PDF รวมรายการงานที่เสร็จสิ้นพร้อมรูปช่วงแล้วเสร็จล่าสุดของแต่ละงาน
            รายงานจะเข้าคิวทันที โดยปกติเสร็จภายในไม่กี่วินาที
          </p>
          <GenerateReportButton projectId={project.id} initiallyDisabled={!canGenerate} />
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">รายงาน</h2>
          {reportsError ? (
            <ErrorNotice>โหลดรายการรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : (
            <ReportsList reports={reports} />
          )}
        </section>
      </div>
    </main>
  );
}
