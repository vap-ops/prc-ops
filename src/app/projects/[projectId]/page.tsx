import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { FileText, Settings } from "lucide-react";
import { SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { projectSettingsHref, reportsHref } from "@/lib/nav/project-paths";
import { ICON_CHIP_MUTED, SECTION_HEADING } from "@/lib/ui/classes";
import { DetailHeader } from "@/components/features/detail-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { PROJECT_TYPE_LABEL } from "@/lib/projects/validate-settings";
import { rankFromPriority } from "@/lib/work-packages/action-bands";
import { WorkPackageList } from "./work-package-list";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "รายการงาน" };

export default async function ProjectWorkPackagesPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name, site_address, client_id, project_lead_id, project_type")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
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
  // `priority` flag (spec 91 follow-up) drives the ด่วน tag + ต้องทำ sort.
  // `is_critical` (critical-path engine) is still a later spec — passed false.
  const { data: workPackages } = await supabase
    .from("work_packages")
    .select("id, code, name, status, deliverable_id, contractor_id, priority")
    .eq("project_id", project.id)
    .order("code", { ascending: true });

  const { data: deliverables } = await supabase
    .from("deliverables")
    .select("id, code, name, sort_order")
    .eq("project_id", project.id)
    .order("sort_order", { ascending: true });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63 shell; spec 82: back goes to the folded /projects hub.
          PM/super get reports + gear chips; SA never sees the gear. */}
      <DetailHeader
        backHref="/projects"
        backLabel="กลับไปโครงการ"
        actions={
          ctx.role === "project_manager" || ctx.role === "super_admin" ? (
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
          ) : null
        }
      >
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">{project.name}</h1>
          {(clientName ||
            leadName ||
            memberNames.length > 0 ||
            typeLabel ||
            project.site_address) && (
            <dl className="text-meta text-ink-secondary mt-1.5 flex flex-col gap-0.5">
              {clientName && (
                <div className="flex gap-1.5">
                  <dt>ลูกค้า:</dt>
                  <dd className="text-ink font-medium">{clientName}</dd>
                </div>
              )}
              {leadName && (
                <div className="flex gap-1.5">
                  <dt>ผู้รับผิดชอบ:</dt>
                  <dd className="text-ink font-medium">{leadName}</dd>
                </div>
              )}
              {memberNames.length > 0 && (
                <div className="flex gap-1.5">
                  <dt>ทีมงาน:</dt>
                  <dd className="text-ink font-medium break-words">{memberNames.join(", ")}</dd>
                </div>
              )}
              {typeLabel && (
                <div className="flex gap-1.5">
                  <dt>ประเภท:</dt>
                  <dd className="text-ink font-medium">{typeLabel}</dd>
                </div>
              )}
              {project.site_address && (
                <div className="flex gap-1.5">
                  <dt>ที่ตั้ง:</dt>
                  <dd className="text-ink font-medium break-words">{project.site_address}</dd>
                </div>
              )}
            </dl>
          )}
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
            isCritical: false,
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
