import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { ErrorNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { projectHref } from "@/lib/nav/project-paths";
import { createClient } from "@/lib/db/server";
import { canGenerateReport, type ReportStatus } from "@/lib/reports/predicates";
import { DETAIL_TITLE, SECTION_HEADING } from "@/lib/ui/classes";
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
    status: r.status,
    storagePath: r.storage_path,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const statuses: ReportStatus[] = reports.map((r) => r.status);
  const canGenerate = canGenerateReport(statuses);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 60 detail header via the spec-63 shell — this is a
          project-scoped surface entered from the project page's
          รายงาน chip (spec 59). */}
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปหน้าโครงการ">
        <div className="min-w-0">
          <p className="text-ink-secondary font-mono text-xs">{project.code}</p>
          <h1 className={DETAIL_TITLE}>รายงาน</h1>
          <p className="text-ink-secondary mt-0.5 text-xs">{project.name}</p>
        </div>
      </DetailHeader>

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <section>
          <p className="text-ink-secondary mb-3 text-sm">
            เลือกเนื้อหาที่ต้องการ แล้วกดสร้างรายงาน PDF — รายงานจะเข้าคิวทันที
            โดยปกติเสร็จภายในไม่กี่วินาที
          </p>
          <GenerateReportButton projectId={project.id} initiallyDisabled={!canGenerate} />
        </section>

        <section>
          <h2 className={SECTION_HEADING}>รายงาน</h2>
          {reportsError ? (
            <ErrorNotice>โหลดรายการรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : (
            <ReportsList reports={reports} />
          )}
        </section>
      </div>
    </PageShell>
  );
}
