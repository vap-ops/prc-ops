import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
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

export default async function ProjectReportsPage({ params }: PageProps) {
  const { projectId } = await params;
  await requireRole(["project_manager", "super_admin"]);
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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider text-zinc-500 uppercase">Project manager</p>
            <h1 className="text-lg font-semibold tracking-tight">Reports</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2">
        <div className="mx-auto flex max-w-2xl items-center gap-4 text-xs">
          <Link
            href="/pm"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            Review queue
          </Link>
          <Link
            href="/pm/projects"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            ← All projects
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
            Generate a PDF report covering the project&apos;s completed work packages and their
            current After photos. Reports queue immediately; generation typically completes within a
            few minutes.
          </p>
          <GenerateReportButton projectId={project.id} initiallyDisabled={!canGenerate} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Reports</h2>
          {reportsError ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              Couldn&apos;t load reports. Please try again.
            </p>
          ) : (
            <ReportsList reports={reports} />
          )}
        </section>
      </div>
    </main>
  );
}
