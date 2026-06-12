import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { RefreshButton } from "@/components/features/refresh-button";
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
    <main className="min-h-screen bg-zinc-50 pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <header className="border-b border-zinc-200 bg-white px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/sa/projects/${project.id}`}
              aria-label="กลับไปรายการงาน"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <ArrowLeft aria-hidden className="h-5 w-5" />
            </Link>
            {/* Spec 53: the PWA's only reload affordance. */}
            <RefreshButton variant="light" />
          </div>
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
        </div>
      </header>

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <SettingsForm
          projectId={project.id}
          initialName={project.name}
          initialStatus={project.status as ProjectStatus}
        />
      </div>
    </main>
  );
}
