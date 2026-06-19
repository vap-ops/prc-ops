import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { projectHref } from "@/lib/nav/project-paths";
import { loadProjectSchedule } from "@/lib/projects/load-schedule";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { ScheduleGantt } from "@/components/features/work-packages/schedule-gantt";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "ตารางงาน" };

export default async function ProjectSchedulePage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const supabase = await createClient();

  // Spec 148 U3: one loader batches the schedule reads (was a serial waterfall).
  // Same queries/columns/results — only the scheduling changes.
  const { project, workPackages, deliverables, depRows, criticalIds } =
    await loadProjectSchedule(supabase, projectId);
  if (!project) notFound();

  const todayISO = bangkokTodayISO();

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปโครงการ">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            ตารางงาน — {project.name}
          </h1>
        </div>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ScheduleGantt
          projectId={project.id}
          todayISO={todayISO}
          workPackages={(workPackages ?? []).map((w) => ({
            id: w.id,
            code: w.code,
            name: w.name,
            status: w.status,
            deliverableId: w.deliverable_id,
            plannedStart: w.planned_start,
            plannedEnd: w.planned_end,
            priority: w.priority,
            isCritical: criticalIds.has(w.id),
          }))}
          deliverables={(deliverables ?? []).map((d) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            sortOrder: d.sort_order,
          }))}
          dependencies={(depRows ?? []).map((d) => ({
            predecessorId: d.predecessor_id,
            successorId: d.successor_id,
          }))}
        />
      </section>
    </PageShell>
  );
}
