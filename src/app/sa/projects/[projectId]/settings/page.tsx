import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { DetailHeader } from "@/components/features/detail-header";
import { StatusPill } from "@/components/features/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import { projectStatusPillClasses } from "@/lib/status-colors";
import type { ProjectStatus } from "@/lib/projects/validate-settings";
import { SettingsForm } from "./settings-form";

// Project settings (spec 58 / ADR 0042) — back office only. SA never
// lands here: requireRole redirects non-pm/super to their role home.

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "ตั้งค่าโครงการ" };

export default async function ProjectSettingsPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63: the consolidated shell. */}
      <DetailHeader backHref={`/sa/projects/${project.id}`} backLabel="กลับไปรายการงาน">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-600">{project.code}</p>
            {/* Spec 57: the page subject never truncates. */}
            <h1 className="text-2xl font-bold tracking-tight break-words">ตั้งค่าโครงการ</h1>
          </div>
          <StatusPill pillClasses={projectStatusPillClasses(project.status)} className="mt-1">
            {PROJECT_STATUS_LABEL[project.status as ProjectStatus] ?? project.status}
          </StatusPill>
        </div>
        <p className="text-xs text-zinc-600">
          รหัสโครงการ <span className="font-mono font-medium text-zinc-900">{project.code}</span>
          <span className="mx-1 text-zinc-400">·</span>
          แก้ไขไม่ได้ (ใช้อ้างอิงการนำเข้าข้อมูล)
        </p>
      </DetailHeader>

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <SettingsForm
          projectId={project.id}
          initialName={project.name}
          initialStatus={project.status as ProjectStatus}
        />
      </div>
    </PageShell>
  );
}
