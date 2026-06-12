import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { RefreshButton } from "@/components/features/refresh-button";
import { WorkPackageList } from "./work-package-list";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: "รายการงาน" };

export default async function ProjectWorkPackagesPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

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
    <main className="min-h-screen bg-zinc-50 pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <header className="border-b border-zinc-200 bg-white px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-1`}>
          <div className="flex items-center justify-between gap-3">
            {/* Spec 55: the spec-54 back chip. */}
            <Link
              href="/sa"
              aria-label="กลับไปโครงการ"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <ArrowLeft aria-hidden className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              {/* Spec 58: project settings — back office only (ADR 0042).
                  SA never sees the gear; the settings page also
                  requireRole-gates pm/super. */}
              {ctx.role === "project_manager" || ctx.role === "super_admin" ? (
                <Link
                  href={`/sa/projects/${project.id}/settings`}
                  aria-label="ตั้งค่าโครงการ"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                >
                  <Settings aria-hidden className="h-5 w-5" />
                </Link>
              ) : null}
              {/* Spec 53: the PWA's only reload affordance. */}
              <RefreshButton variant="light" />
            </div>
          </div>
          <p className="font-mono text-xs text-zinc-600">{project.code}</p>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
        </div>
      </header>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className="mb-3 text-base font-semibold text-zinc-900">รายการงาน</h2>
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
    </main>
  );
}
