import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { CalendarDays, FileText, Settings } from "lucide-react";
import { PROJECT_VIEW_ROLES } from "@/lib/auth/role-home";
import { projectSettingsHref, reportsHref, scheduleHref } from "@/lib/nav/project-paths";
import { ICON_CHIP_MUTED, SECTION_HEADING } from "@/lib/ui/classes";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { ProjectInfoButton } from "@/components/features/work-packages/project-info-button";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { StatusPill } from "@/components/features/common/status-pill";
import { EmptyNotice } from "@/components/features/common/notices";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { PROJECT_TYPE_LABEL } from "@/lib/projects/validate-settings";
import { rankFromPriority } from "@/lib/work-packages/action-bands";
import { criticalWorkPackageIds } from "@/lib/work-packages/critical-path";
import { WorkPackageList } from "./work-package-list";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "รายการงาน" };

export default async function ProjectWorkPackagesPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(PROJECT_VIEW_ROLES);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name, site_address, client_id, project_lead_id, project_type")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  // Spec 102: procurement gets a READ-ONLY WP list (names + status only) for
  // purchase context — no capture/links, no schedule/reports/gear chips, no
  // bank-adjacent info. Early return keeps the SA/PM path below untouched.
  if (ctx.role === "procurement") {
    const { data: procWps } = await supabase
      .from("work_packages")
      .select("id, code, name, status")
      .eq("project_id", project.id)
      .order("code", { ascending: true });
    return (
      <PageShell>
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref="/projects" backLabel="กลับไปโครงการ">
          <div>
            <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
            <h1 className="text-title text-ink font-bold tracking-tight">{project.name}</h1>
          </div>
        </DetailHeader>
        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
          <h2 className={SECTION_HEADING}>รายการงาน</h2>
          {(procWps ?? []).length === 0 ? (
            <EmptyNotice>ยังไม่มีรายการงาน</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {(procWps ?? []).map((wp) => (
                <li
                  key={wp.id}
                  className="rounded-card border-edge bg-card shadow-card flex items-center justify-between gap-3 border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-ink text-body font-medium break-words">{wp.name}</p>
                    <p className="text-ink-secondary font-mono text-xs">{wp.code}</p>
                  </div>
                  <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)}>
                    {WORK_PACKAGE_STATUS_LABEL[wp.status] ?? wp.status}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageShell>
    );
  }

  // Spec 79: project-context lines (client name, internal lead, type, site).
  // budget is intentionally NOT read here (money — admin-only, PM screens).
  const [clientRow, { data: memberRows }] = await Promise.all([
    project.client_id
      ? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("project_members").select("user_id").eq("project_id", project.id),
  ]);
  const clientName = clientRow.data?.name ?? null;
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const nameIds = [
    ...new Set([...(project.project_lead_id ? [project.project_lead_id] : []), ...memberIds]),
  ];
  const names = nameIds.length
    ? await fetchDisplayNames(nameIds, "[project-page]")
    : new Map<string, string>();
  const leadName = project.project_lead_id ? (names.get(project.project_lead_id) ?? null) : null;
  const memberNames = memberIds
    .map((id) => names.get(id) ?? null)
    .filter((n): n is string => n !== null);
  const typeLabel = project.project_type ? PROJECT_TYPE_LABEL[project.project_type] : null;

  // Field-First worklist: action bands derive from `status`; the manual
  // `priority` flag (spec 91) drives the ด่วน tag + ต้องทำ sort; `isCritical`
  // is computed below from the schedule + dependencies (spec 92).
  const { data: workPackages } = await supabase
    .from("work_packages")
    .select(
      "id, code, name, status, deliverable_id, contractor_id, priority, planned_start, planned_end",
    )
    .eq("project_id", project.id)
    .order("code", { ascending: true });

  const { data: deliverables } = await supabase
    .from("deliverables")
    .select("id, code, name, sort_order")
    .eq("project_id", project.id)
    .order("sort_order", { ascending: true });

  // Spec 92: critical path computed on read from planned windows + finish-to-
  // start dependencies. Lights the worklist CRITICAL_BADGE for path WPs.
  const wpIds = (workPackages ?? []).map((wp) => wp.id);
  const { data: dependencyRows } = wpIds.length
    ? await supabase
        .from("work_package_dependencies")
        .select("predecessor_id, successor_id")
        .in("predecessor_id", wpIds)
    : { data: [] };
  const criticalIds = criticalWorkPackageIds(
    (workPackages ?? []).map((wp) => ({
      id: wp.id,
      plannedStart: wp.planned_start,
      plannedEnd: wp.planned_end,
    })),
    (dependencyRows ?? []).map((d) => ({
      predecessorId: d.predecessor_id,
      successorId: d.successor_id,
    })),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63 shell; spec 82: back goes to the folded /projects hub.
          PM/super get reports + gear chips; SA never sees the gear. */}
      <DetailHeader
        backHref="/projects"
        backLabel="กลับไปโครงการ"
        actions={
          <>
            {/* Spec 94: project context (client/lead/team/type/site) folds into
                this ⓘ sheet so the sticky header stays short. */}
            {(clientName ||
              leadName ||
              memberNames.length > 0 ||
              typeLabel ||
              project.site_address) && (
              <ProjectInfoButton
                clientName={clientName}
                leadName={leadName}
                memberNames={memberNames}
                typeLabel={typeLabel}
                siteAddress={project.site_address}
              />
            )}
            {/* Schedule calendar — all staff (spec 92). */}
            <Link href={scheduleHref(project.id)} aria-label="ตารางงาน" className={ICON_CHIP_MUTED}>
              <CalendarDays aria-hidden className="h-5 w-5" />
            </Link>
            {ctx.role === "project_manager" || ctx.role === "super_admin" ? (
              <>
                <Link
                  href={reportsHref(project.id)}
                  aria-label="รายงานโครงการ"
                  className={ICON_CHIP_MUTED}
                >
                  <FileText aria-hidden className="h-5 w-5" />
                </Link>
                <Link
                  href={projectSettingsHref(project.id)}
                  aria-label="ตั้งค่าโครงการ"
                  className={ICON_CHIP_MUTED}
                >
                  <Settings aria-hidden className="h-5 w-5" />
                </Link>
              </>
            ) : null}
          </>
        }
      >
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">{project.name}</h1>
        </div>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>รายการงาน</h2>
        <WorkPackageList
          projectId={project.id}
          role={ctx.role}
          workPackages={(workPackages ?? []).map((wp) => ({
            id: wp.id,
            code: wp.code,
            name: wp.name,
            status: wp.status,
            deliverableId: wp.deliverable_id,
            hasContractor: wp.contractor_id !== null,
            // Manual PM/super urgency flag → ด่วน tag + ต้องทำ sort (spec 91
            // follow-up). isCritical stays reserved for the critical-path engine.
            priority: wp.priority,
            priorityRank: rankFromPriority(wp.priority),
            isCritical: criticalIds.has(wp.id),
          }))}
          deliverables={(deliverables ?? []).map((d) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            sortOrder: d.sort_order,
          }))}
        />
      </section>
    </PageShell>
  );
}
