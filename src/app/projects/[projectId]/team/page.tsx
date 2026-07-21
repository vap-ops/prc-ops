import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { TeamMapView } from "@/components/features/team-map/team-map-view";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import type { Database } from "@/lib/db/database.types";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { addDaysIso } from "@/lib/work-packages/calendar-grid";
import { PROJECT_TEAM_LABEL } from "@/lib/i18n/labels";
import { projectHref } from "@/lib/nav/project-paths";
import { loadTeamMapPageData } from "@/lib/team-map/load-team-map";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { foldWorkerTrades, type WorkerTrade } from "@/lib/workers/trades";
import type { TeamMapDayPlan } from "@/lib/work-plans/day-assignments";

// Spec 330 U1+U5+U6 — the per-project team map (ทีมงานโครงการ): the PM-tier
// people cockpit. Tiers ผู้บริหารโครงการ → หน้างาน → ทีมช่าง; staff manage
// rides the existing spec-80/292 member actions; crew manage rides the U2
// RPCs; U6 shows + edits the day's WP↔team assignment over the daily plan.

// U6 read: one day's board as tray-able items. RLS (can_see_project on all
// three plan tables) scopes it to the signed-in user; a non-member reads
// empty, same as the rest of the page. Read-only — writes go through the
// existing /sa/plan server actions.
async function loadDayPlan(
  supabase: SupabaseClient<Database>,
  projectId: string,
  date: string,
): Promise<TeamMapDayPlan> {
  const { data: plan } = await supabase
    .from("daily_work_plans")
    .select("id")
    .eq("project_id", projectId)
    .eq("plan_date", date)
    .maybeSingle();
  if (!plan) return { date, items: [] };

  // Spec 338 U3: the WP's firm W-code rides along. TWO-hop embed — the
  // category FK targets project_categories, whose work_category_id reaches the
  // firm taxonomy (project_categories.code is a per-project editable string,
  // NOT the taxonomy; fact-checked live 2026-07-22).
  const { data: items } = await supabase
    .from("daily_work_plan_items")
    .select(
      "id, work_package_id, sort_order, work_packages(code, name, project_categories(work_categories(code)))",
    )
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: true });
  if (!items || items.length === 0) return { date, items: [] };

  const { data: crew } = await supabase
    .from("daily_work_plan_crew")
    .select("item_id, worker_id")
    .in(
      "item_id",
      items.map((i) => i.id),
    );
  const byItem = new Map<string, string[]>();
  for (const row of crew ?? []) {
    const list = byItem.get(row.item_id);
    if (list) list.push(row.worker_id);
    else byItem.set(row.item_id, [row.worker_id]);
  }

  return {
    date,
    items: items.map((i) => ({
      itemId: i.id,
      workPackageId: i.work_package_id,
      code: i.work_packages?.code ?? "",
      name: i.work_packages?.name ?? "",
      workerIds: byItem.get(i.id) ?? [],
      categoryCode: i.work_packages?.project_categories?.work_categories?.code ?? null,
    })),
  };
}

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

  const today = bangkokTodayIso();
  const tomorrow = addDaysIso(today, 1);
  const [{ map, addableStaff }, todayPlan, tomorrowPlan, { data: leafWps }] = await Promise.all([
    loadTeamMapPageData(supabase, project.id, project.project_lead_id),
    loadDayPlan(supabase, project.id, today),
    loadDayPlan(supabase, project.id, tomorrow),
    // เพิ่มงานเข้าแผน picker: leaf WPs only (add_daily_plan_item hard-rejects
    // groups) and nothing already complete.
    supabase
      .from("work_packages")
      .select("id, code, name")
      .eq("project_id", projectId)
      .eq("is_group", false)
      .neq("status", "complete")
      .order("code", { ascending: true }),
  ]);

  // Spec 338 U2: trades ride a page-level prop — the builder stays a pure
  // structure fold. RLS: worker_trades_select is authenticated-wide (verified
  // live), so the user's own client reads it; a fetch error degrades to no
  // tiles, never an error surface.
  const workerIds = map.teams.flatMap((t) => t.members.map((m) => m.workerId));
  let tradesByWorker: Record<string, WorkerTrade[]> = {};
  if (workerIds.length > 0) {
    const { data: tradeRows } = await supabase
      .from("worker_trades")
      .select("worker_id, work_category_id, is_primary, work_categories(code, name_th)")
      .in("worker_id", workerIds);
    tradesByWorker = foldWorkerTrades(tradeRows ?? []);
  }

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
          tradesByWorker={tradesByWorker}
          dayPlans={{ today: todayPlan, tomorrow: tomorrowPlan }}
          planWps={leafWps ?? []}
        />
      </div>
    </PageShell>
  );
}
