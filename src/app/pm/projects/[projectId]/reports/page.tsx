import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { ErrorNotice } from "@/components/features/notices";
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
    <main className="min-h-screen bg-zinc-950 pb-20 text-zinc-100 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="ผู้จัดการโครงการ" title="รายงาน" maxWidthClass="max-w-2xl" />

      <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2">
        <div className="mx-auto flex max-w-2xl items-center gap-4 text-xs">
          <Link
            href="/pm"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            รายการรอตรวจ
          </Link>
          <Link
            href="/pm/projects"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            ← โครงการทั้งหมด
          </Link>
        </div>
      </nav>

      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-6">
        <section>
          <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="font-mono text-xs text-zinc-500">{project.code}</p>
            <p className="truncate text-base font-medium text-zinc-100">{project.name}</p>
          </div>
          <p className="mb-3 text-sm text-zinc-400">
            สร้างรายงาน PDF รวมรายการงานที่เสร็จสิ้นพร้อมรูปช่วงแล้วเสร็จล่าสุดของแต่ละงาน
            รายงานจะเข้าคิวทันที โดยปกติใช้เวลาสร้างไม่กี่นาที
          </p>
          <GenerateReportButton projectId={project.id} initiallyDisabled={!canGenerate} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">รายงาน</h2>
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
