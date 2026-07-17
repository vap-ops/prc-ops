// Spec 325 Phase 1 U2 — /projects/[projectId]/costs: the per-project cost view
// (per-WP material + labour + project family totals; equipment at project
// grain). Money surface: requireRole(PURCHASE_REPORT_ROLES) — exactly the spec
// §4 audience (PM tier + procurement tiers + accounting; field roles excluded,
// spec 46). Reads via the admin client behind that gate (day_rate_snapshot /
// labor_budget / settlements carry no authenticated grant); the project row
// itself is read under the caller's RLS so an unseen project 404s (rentals-page
// precedent). Multi-parent surface (project chip row + procurement hub door) →
// referrer-aware back chip per nav-coherence Decision 1.

import { notFound } from "next/navigation";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASE_REPORT_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { loadProjectCosts } from "@/lib/costs/load-project-costs";
import { safeBackHref } from "@/lib/nav/back-href";
import { projectHref } from "@/lib/nav/project-paths";
import { PROJECT_COSTS_LABEL } from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { ProjectCostsView } from "./costs-view";

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}

export default async function ProjectCostsPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(PURCHASE_REPORT_ROLES);

  const supabase = await createServerSupabase();
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const { from } = await searchParams;
  const admin = createAdminSupabase();
  const data = await loadProjectCosts(admin, project.id);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, projectHref(project.id))} backLabel="กลับ">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            {PROJECT_COSTS_LABEL} — {project.name}
          </h1>
        </div>
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ProjectCostsView rows={data.rows} families={data.families} rental={data.rental} />
      </section>
    </PageShell>
  );
}
