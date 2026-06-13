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
  // Resolve the lead + member display names in one admin lookup (users RLS is read-self).
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

  const { data: workPackages } = await supabase
    .from("work_packages")
    .select("id, code, name, status, deliverable_id")
    .eq("project_id", project.id)
    .order("code", { ascending: true });

  // Deliverables for the grouping headers (spec 11). RLS admits
  // sa/pm/super SELECT (spec 04 Phase 1). Empty today — the list
  // degrades to flat until spec 04 Phase 2 backfills the data.
  const { data: deliverables } = await supabase
    .from("deliverables")
    .select("id, code, name, sort_order")
    .eq("project_id", project.id)
    .order("sort_order", { ascending: true });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63: the consolidated shell. Spec 82 Unit 3: back goes to the
          single folded /projects hub (was the role-aware projectHubHref).
          The spec-58/59 pm/super chips ride the actions slot — SA never
          sees the gear; the settings page also requireRole-gates. */}
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
          <p className="font-mono text-xs text-zinc-600">{project.code}</p>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {(clientName ||
            leadName ||
            memberNames.length > 0 ||
            typeLabel ||
            project.site_address) && (
            <dl className="mt-1.5 flex flex-col gap-0.5 text-xs text-zinc-600">
              {clientName && (
                <div className="flex gap-1.5">
                  <dt>ลูกค้า:</dt>
                  <dd className="font-medium text-zinc-900">{clientName}</dd>
                </div>
              )}
              {leadName && (
                <div className="flex gap-1.5">
                  <dt>ผู้รับผิดชอบ:</dt>
                  <dd className="font-medium text-zinc-900">{leadName}</dd>
                </div>
              )}
              {memberNames.length > 0 && (
                <div className="flex gap-1.5">
                  <dt>ทีมงาน:</dt>
                  <dd className="font-medium break-words text-zinc-900">
                    {memberNames.join(", ")}
                  </dd>
                </div>
              )}
              {typeLabel && (
                <div className="flex gap-1.5">
                  <dt>ประเภท:</dt>
                  <dd className="font-medium text-zinc-900">{typeLabel}</dd>
                </div>
              )}
              {project.site_address && (
                <div className="flex gap-1.5">
                  <dt>ที่ตั้ง:</dt>
                  <dd className="font-medium break-words text-zinc-900">{project.site_address}</dd>
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
          workPackages={(workPackages ?? []).map((wp) => ({
            id: wp.id,
            code: wp.code,
            name: wp.name,
            status: wp.status,
            deliverableId: wp.deliverable_id,
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
