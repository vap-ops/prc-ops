import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { projectHref } from "@/lib/nav/project-paths";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { PM_ROLES, SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import { projectStatusPillClasses } from "@/lib/status-colors";
import { projectStatusIcon } from "@/lib/status-icons";
import { SettingsForm } from "./settings-form";

// Project settings (spec 58 / 79, ADR 0042) — back office only. SA never
// lands here: requireRole redirects non-pm/super to their role home.

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "ตั้งค่าโครงการ" };

export default async function ProjectSettingsPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createClient();

  // budget_amount_thb is omitted here — SELECT is revoked from authenticated
  // (money isolation, spec 79); it is read via the admin client below.
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, notes, site_address, gmap_url, contract_reference, start_date, planned_completion_date, client_id, project_lead_id, project_type",
    )
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  // Admin client (this page is requireRole pm/super): budget (money), the
  // clients list, and the staff roster for the project-lead picker. Staff
  // come via admin because public.users RLS is read-self (ADR 0011).
  const admin = createAdminClient();
  const [{ data: budgetRow }, { data: clients }, { data: staff }, { data: members }] =
    await Promise.all([
      admin.from("projects").select("budget_amount_thb").eq("id", projectId).maybeSingle(),
      supabase.from("clients").select("id, name").order("name"),
      admin
        .from("users")
        .select("id, full_name")
        .in("role", [...SITE_STAFF_ROLES])
        .order("full_name", { nullsFirst: false }),
      // Spec 80: current team members (staff SELECT allows the user session).
      supabase.from("project_members").select("user_id").eq("project_id", projectId),
    ]);

  const staffList = (staff ?? []).map((u) => ({ id: u.id, name: u.full_name }));
  const staffName = new Map(staffList.map((s) => [s.id, s.name]));
  const memberList = (members ?? []).map((m) => ({
    id: m.user_id,
    name: staffName.get(m.user_id) ?? null,
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปรายการงาน">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-secondary font-mono text-xs">{project.code}</p>
            <h1 className="text-2xl font-bold tracking-tight break-words">ตั้งค่าโครงการ</h1>
          </div>
          <StatusPill
            pillClasses={projectStatusPillClasses(project.status)}
            icon={projectStatusIcon(project.status)}
            className="mt-1"
          >
            {PROJECT_STATUS_LABEL[project.status] ?? project.status}
          </StatusPill>
        </div>
        <p className="text-ink-secondary text-xs">
          รหัสโครงการ <span className="text-ink font-mono font-medium">{project.code}</span>
          <span className="text-ink-muted mx-1">·</span>
          แก้ไขไม่ได้ (ใช้อ้างอิงการนำเข้าข้อมูล)
        </p>
      </DetailHeader>

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <SettingsForm
          projectId={project.id}
          initialName={project.name}
          initialStatus={project.status}
          initialNotes={project.notes}
          initialSiteAddress={project.site_address}
          initialGmapUrl={project.gmap_url}
          contractReference={project.contract_reference}
          initialStartDate={project.start_date}
          initialPlannedCompletionDate={project.planned_completion_date}
          initialClientId={project.client_id}
          initialProjectLeadId={project.project_lead_id}
          initialProjectType={project.project_type}
          initialBudget={budgetRow?.budget_amount_thb ?? null}
          clients={clients ?? []}
          staff={staffList}
          members={memberList}
          currentUserId={ctx.id}
        />
      </div>
    </PageShell>
  );
}
