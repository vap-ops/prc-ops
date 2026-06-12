import Link from "next/link";
import { notFound } from "next/navigation";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
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
        <div className="mx-auto flex max-w-2xl flex-col gap-1 lg:max-w-5xl">
          <Link
            href="/sa"
            className="w-fit text-xs font-medium text-blue-700 hover:underline focus:outline-none focus-visible:underline"
          >
            ← โครงการ
          </Link>
          <p className="font-mono text-xs text-zinc-600">{project.code}</p>
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6 lg:max-w-5xl">
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
