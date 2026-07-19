import { notFound } from "next/navigation";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { TeamMapView } from "@/components/features/team-map/team-map-view";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { PROJECT_TEAM_LABEL } from "@/lib/i18n/labels";
import { projectHref } from "@/lib/nav/project-paths";
import { loadTeamMapPageData } from "@/lib/team-map/load-team-map";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

// Spec 330 U1 — the per-project team map (ทีมงานโครงการ): the PM-tier people
// cockpit. Tiers ผู้บริหารโครงการ → หน้างาน → ทีมช่าง; staff manage rides the
// existing spec-80/292 member actions. Crew/team manage arrives with U2/U3.

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: PROJECT_TEAM_LABEL };

export default async function ProjectTeamPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createClient();

  // RLS scopes the read: a PM outside the membership gets no row → 404.
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name, project_lead_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const { map, addableStaff } = await loadTeamMapPageData(
    supabase,
    project.id,
    project.project_lead_id,
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปโครงการ">
        <div>
          <p className="text-ink-secondary font-mono text-xs">{project.code}</p>
          <h1 className="text-2xl font-bold tracking-tight break-words">{PROJECT_TEAM_LABEL}</h1>
        </div>
        <p className="text-ink-secondary text-xs">{project.name}</p>
      </DetailHeader>
      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col px-5 py-6`}>
        <TeamMapView
          projectId={project.id}
          map={map}
          addableStaff={addableStaff}
          currentUserId={ctx.id}
        />
      </div>
    </PageShell>
  );
}
