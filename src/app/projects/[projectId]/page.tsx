import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { CalendarDays, FileText, Settings } from "lucide-react";
import {
  PROJECT_VIEW_ROLES,
  SCHEDULE_VIEW_ROLES,
  WP_DETAIL_ROLES,
  isManagerRole,
} from "@/lib/auth/role-home";
import { projectSettingsHref, reportsHref, scheduleHref } from "@/lib/nav/project-paths";
import { ICON_CHIP_MUTED } from "@/lib/ui/classes";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { ProjectInfoButton } from "@/components/features/work-packages/project-info-button";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PROJECT_TYPE_LABEL } from "@/lib/projects/validate-settings";
import { rankFromPriority } from "@/lib/work-packages/action-bands";
import { loadProjectDetail } from "@/lib/projects/load-detail";
import { WorkPackageList } from "./work-package-list";
import { OnboardingChecklist } from "./onboarding-checklist";
import { DeliverablesManager } from "./deliverables-manager";
import { AddWorkPackageSheet } from "./add-work-package-sheet";
import { CopyWorkPackagesSheet } from "./copy-work-packages-sheet";
import { ImportWorkPackagesSheet } from "./import-work-packages-sheet";
import { ApplyTemplateButton } from "./apply-template-button";

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
    .select(
      "id, code, name, status, site_address, gmap_url, start_date, planned_completion_date, client_id, project_lead_id, project_type",
    )
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  // Spec 173: procurement is a first-class READ-ONLY viewer of this page now —
  // it flows through the main path below, where every write affordance is already
  // gated (isPmRole / isManagerRole hide onboarding, seeding, the งวดงาน manager,
  // and the reports/gear chips; canOpenWp / canOpenSchedule admit it to WP detail
  // + the schedule). This supersedes the spec-102 stopgap branch (a minimal
  // names+status WP list) — the operator asked procurement to see the schedule,
  // the งวดงาน grouping, WP details, and the project info, i.e. the full view.

  // Spec 142 U3: PM/super get onboarding + the copy/template seeding controls.
  const isPmRole = isManagerRole(ctx.role);
  // Spec 154 / 173: can this viewer OPEN the WP detail + schedule from here?
  // project_coordinator reads via PROJECT_VIEW_ROLES but the WP-detail/schedule
  // gates deny it (a bounce), so its rows stay non-interactive + chip hidden.
  // Spec 173 U3: procurement may open WP detail read-only (it is in WP_DETAIL_ROLES,
  // spec 171) — re-express the WP-row gate as WP_DETAIL_ROLES so the row click
  // restores the navigation path. Spec 173 U2: the schedule chip follows
  // SCHEDULE_VIEW_ROLES (site staff + procurement; coordinator still excluded).
  const canOpenWp = WP_DETAIL_ROLES.includes(ctx.role);
  const canOpenSchedule = SCHEDULE_VIEW_ROLES.includes(ctx.role);
  // Spec 145: a completed/archived project is locked for new work — the UI hides
  // the seeding controls + onboarding and shows a banner. Defect-rework stays.
  const projectOpen = project.status === "active" || project.status === "on_hold";

  // Spec 147 U2: one loader batches the project-detail reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  // budget is intentionally NOT read here (money — admin-only, PM screens).
  const {
    clientName,
    leadName,
    memberNames,
    workPackages,
    deliverables,
    criticalIds,
    onboarding,
    sourceProjects,
    templateAvailable,
  } = await loadProjectDetail(supabase, project, isPmRole);
  const typeLabel = project.project_type ? PROJECT_TYPE_LABEL[project.project_type] : null;
  // Spec 174: a pasted Google-Maps link (exact pin) wins; spec 173 falls back to an
  // address-derived search URL when no link is set; null when neither exists.
  const mapsUrl =
    project.gmap_url ??
    (project.site_address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.site_address)}`
      : null);

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
                this ⓘ sheet so the sticky header stays short. Spec 173 U4: status +
                schedule dates + a Google-Maps link join it; status is always present
                so the sheet always renders now. */}
            <ProjectInfoButton
              clientName={clientName}
              leadName={leadName}
              memberNames={memberNames}
              typeLabel={typeLabel}
              siteAddress={project.site_address}
              statusLabel={PROJECT_STATUS_LABEL[project.status]}
              startDate={project.start_date}
              plannedCompletionDate={project.planned_completion_date}
              mapsUrl={mapsUrl}
            />
            {/* Schedule calendar — SCHEDULE_VIEW_ROLES (site staff + procurement,
                spec 173 U2). Spec 154: still hidden for project_coordinator, which
                can't follow it (was a bounce). */}
            {canOpenSchedule ? (
              <Link
                href={scheduleHref(project.id)}
                aria-label="ตารางงาน"
                className={ICON_CHIP_MUTED}
              >
                <CalendarDays aria-hidden className="h-5 w-5" />
              </Link>
            ) : null}
            {isManagerRole(ctx.role) ? (
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
        {/* Spec 145: a closed project shows a lock banner instead of seeding
            controls. Warranty defect-rework stays available on each WP page. */}
        {!projectOpen && (
          <div className="rounded-card border-edge bg-sunk text-ink-secondary mb-4 border px-4 py-3 text-sm">
            โครงการนี้เสร็จสิ้น/ปิดแล้ว — เพิ่มหรือนำเข้างานใหม่ไม่ได้
            (ยังเปิดงานแก้ไขช่วงประกันในแต่ละงานได้) หากต้องการแก้ไขโครงการ เปลี่ยนสถานะกลับเป็น
            “กำลังดำเนินการ” ในหน้าตั้งค่า
          </div>
        )}
        {isPmRole && projectOpen && onboarding && (
          <OnboardingChecklist
            projectId={project.id}
            status={onboarding}
            // Spec 164 U4: done = ≥1 งวด AND no ungrouped งาน (every WP grouped;
            // vacuously true when there are no WPs yet).
            deliverablesDone={
              (deliverables ?? []).length > 0 &&
              (workPackages ?? []).every((wp) => wp.deliverable_id !== null)
            }
          />
        )}
        {/* Spec 164 U1: งวดงาน manager — the in-app home/door for deliverables
            (PM-only, open projects). Counts derive from the WP list already
            loaded. */}
        {isPmRole && projectOpen && (
          <DeliverablesManager
            projectId={project.id}
            deliverables={(deliverables ?? []).map((d) => ({
              id: d.id,
              code: d.code,
              name: d.name,
              wpCount: (workPackages ?? []).filter((wp) => wp.deliverable_id === d.id).length,
            }))}
            ungroupedWorkPackages={(workPackages ?? [])
              .filter((wp) => wp.deliverable_id === null)
              .map((wp) => ({ id: wp.id, code: wp.code, name: wp.name }))}
          />
        )}
        <div className="mb-3 flex items-center justify-between gap-3">
          {/* SECTION_HEADING tokens minus its mb-3 — the row owns the gap so
              the heading and the h-11 action buttons center on each other. */}
          <h2 id="work-packages" className="text-section text-ink font-semibold">
            รายการงาน
          </h2>
          {isPmRole && projectOpen && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {templateAvailable && <ApplyTemplateButton projectId={project.id} />}
              <ImportWorkPackagesSheet projectId={project.id} />
              {sourceProjects.length > 0 && (
                <CopyWorkPackagesSheet projectId={project.id} sourceProjects={sourceProjects} />
              )}
              <AddWorkPackageSheet projectId={project.id} />
            </div>
          )}
        </div>
        <WorkPackageList
          projectId={project.id}
          role={ctx.role}
          canOpen={canOpenWp}
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
