// Spec 273 U2 (ADR 0076) — /sa แผนพรุ่งนี้: the SA next-day work board. Server
// component: resolves the SA's project (RLS-scoped; picker if >1), computes พรุ่งนี้
// (Bangkok tz), and loads the not-complete งานย่อย, the project roster, and any
// existing board for tomorrow. All reads are RLS-scoped (can_see_project); every
// mutation goes through the U1 RPCs via src/app/sa/plan/actions.ts. This is the
// daily-plan layer — it never reads or writes the master schedule / baselines.

import type { ReactNode } from "react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { getSaCurrentProject } from "@/lib/sa/current-project.server";
import { bangkokTodayIso } from "@/lib/dates";
import { resolvePlanDate } from "@/app/sa/plan/plan-date";
import { DAILY_WORK_PLAN_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { buildWpPickerGroups, type WpPickerRow } from "@/lib/work-packages/picker-options";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { addDaysIso } from "@/lib/work-packages/calendar-grid";
import { buildTomorrowDraft } from "@/lib/sa/tomorrow-draft";
import { DailyPlanBoard, type DailyPlanItemView } from "@/components/features/sa/daily-plan-board";

export const metadata = { title: DAILY_WORK_PLAN_LABEL };

export default async function SaPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; date?: string }>;
}) {
  const ctx = await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();
  const { project: qProject, date: qDate } = await searchParams;

  const shell = (body: ReactNode) => (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/sa" backLabel="หน้าหลัก">
        <h1 className="text-title text-ink font-bold tracking-tight">{DAILY_WORK_PLAN_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>{body}</div>
    </PageShell>
  );

  // Spec 292 U3 — one RLS-scoped read (same can_see_project scope, superset
  // projection) yields both the visible project list AND the resolved current
  // project. Precedence: a valid+visible ?project= (view-only for this render) >
  // the sa_active_project override cookie > primary > derived-most-recent. The
  // resolver validates ?project= against the visible list internally, so the old
  // inline UUID/visibility check is folded in.
  const { current, visibleProjects } = await getSaCurrentProject(supabase, ctx.id, {
    queryProjectId: qProject && UUID_REGEX.test(qProject) ? qProject : null,
  });
  const projects = visibleProjects;
  if (projects.length === 0) {
    return shell(<EmptyNotice>ยังไม่มีโครงการที่ดูแล</EmptyNotice>);
  }

  // projects is non-empty here, so the resolver never returns null; the ?? keeps
  // the type honest (SaCurrentProject.projectId is string | null).
  const selectedProjectId = current.projectId ?? projects[0]!.id;
  const today = bangkokTodayIso();
  const selectedDate = resolvePlanDate(qDate, today);

  // Groups (for the picker's section labels) + every leaf; filter to non-complete
  // leaves below. Both levels come from one project-scoped read.
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name, status, is_group, parent_id, priority, category_id")
    .eq("project_id", selectedProjectId);
  const wps = wpRows ?? [];

  // Spec 328 U3 — contractor-tied workers (pay-exempt subcon members) are
  // excluded: planned crew flows into labor_logs via mark-present →
  // logLaborDays, and their labor is not PRC cost (§2.4 money wall — same
  // filter as the WP capture picker's groupRoster).
  const { data: workerRows } = await supabase
    .from("workers")
    .select("id, name")
    .eq("project_id", selectedProjectId)
    .eq("active", true)
    .is("contractor_id", null)
    .order("name");
  const workers = workerRows ?? [];

  // The existing board for the selected day (at most one — unique(project, plan_date)).
  const { data: plan } = await supabase
    .from("daily_work_plans")
    .select("id")
    .eq("project_id", selectedProjectId)
    .eq("plan_date", selectedDate)
    .maybeSingle();
  const planId = plan?.id ?? null;

  let items: DailyPlanItemView[] = [];
  if (planId) {
    const { data: itemRows } = await supabase
      .from("daily_work_plan_items")
      .select("id, work_package_id, note, sort_order")
      .eq("plan_id", planId)
      .order("sort_order");
    const its = itemRows ?? [];
    const { data: crewRows } = await supabase
      .from("daily_work_plan_crew")
      .select("item_id, worker_id, is_lead")
      .in(
        "item_id",
        its.map((i) => i.id),
      );
    const crew = crewRows ?? [];
    const wpById = new Map(wps.map((w) => [w.id, w]));
    items = its.map((i) => {
      const wp = wpById.get(i.work_package_id);
      return {
        id: i.id,
        workPackageId: i.work_package_id,
        code: wp?.code ?? "",
        name: wp?.name ?? "",
        note: i.note ?? "",
        crew: crew
          .filter((c) => c.item_id === i.id)
          .map((c) => ({ workerId: c.worker_id, isLead: c.is_lead })),
      };
    });
  }

  // Available options = งาน groups (labels) + non-complete leaves NOT already on the board.
  const addedWpIds = new Set(items.map((i) => i.workPackageId));
  const pickerRows: WpPickerRow[] = wps
    .filter((w) => w.is_group || (w.status !== "complete" && !addedWpIds.has(w.id)))
    .map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      isGroup: w.is_group,
      parentId: w.parent_id,
    }));
  const leafOptions = buildWpPickerGroups(pickerRows);

  // Spec 281 U2 — the แนะนำแผนพรุ่งนี้ draft for the selected board date. Every read is
  // RLS-scoped to this project (can_see_project); the draft is ephemeral (in-memory) —
  // nothing is written until the SA approves it via <DailyPlanSuggestions> (D5). The
  // recommender leans on this thin 273 board history for crew continuity (§7.1) and the
  // latest 271 baseline for the ช้ากว่าแผน tier, both degrading to empty when unbound.
  const recentWindowStart = addDaysIso(today, -14);
  const [crewRes, memberRes, recentPlanRes, categoryRes, baselineRes] = await Promise.all([
    supabase
      .from("crews")
      .select("id, name, lead_worker_id")
      .eq("active", true)
      .eq("project_id", selectedProjectId),
    supabase.from("crew_members").select("crew_id, worker_id").is("removed_at", null),
    supabase
      .from("daily_work_plans")
      .select("id, plan_date")
      .eq("project_id", selectedProjectId)
      .gte("plan_date", recentWindowStart)
      .lte("plan_date", today)
      .order("plan_date", { ascending: false }),
    supabase
      .from("project_categories")
      .select("id, work_categories(code)")
      .eq("project_id", selectedProjectId),
    supabase
      .from("plan_baselines")
      .select("id")
      .eq("project_id", selectedProjectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const recentPlans = recentPlanRes.data ?? [];
  const planDateById = new Map(recentPlans.map((p) => [p.id, p.plan_date]));
  const recentPlanIds = recentPlans.map((p) => p.id);
  const baselineId = baselineRes.data?.id ?? null;

  const [recentItemRes, baselineItemRes] = await Promise.all([
    recentPlanIds.length
      ? supabase
          .from("daily_work_plan_items")
          .select("id, work_package_id, plan_id")
          .in("plan_id", recentPlanIds)
      : Promise.resolve({ data: null }),
    baselineId
      ? supabase
          .from("plan_baseline_items")
          .select("work_package_id, planned_end")
          .eq("baseline_id", baselineId)
      : Promise.resolve({ data: null }),
  ]);

  // Order items newest-board-first so the recent-continuity crew per งาน resolves to
  // the most recent board (the assembler's newest-first contract).
  const recentPlanItems = (recentItemRes.data ?? [])
    .map((i) => ({
      id: i.id,
      work_package_id: i.work_package_id,
      planDate: planDateById.get(i.plan_id) ?? "",
    }))
    .sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0))
    .map(({ id, work_package_id }) => ({ id, work_package_id }));
  const recentItemIds = recentPlanItems.map((i) => i.id);

  const { data: recentCrewRows } = recentItemIds.length
    ? await supabase
        .from("daily_work_plan_crew")
        .select("item_id, worker_id")
        .in("item_id", recentItemIds)
    : { data: null };

  const categoryCodeById = new Map<string, string>();
  for (const c of categoryRes.data ?? []) {
    const wc = c.work_categories;
    const code = (Array.isArray(wc) ? wc[0]?.code : wc?.code) ?? null;
    if (code) categoryCodeById.set(c.id, code);
  }
  const baselineFinishByWp = new Map<string, string>();
  for (const b of baselineItemRes.data ?? []) {
    baselineFinishByWp.set(b.work_package_id, b.planned_end);
  }

  const draft = buildTomorrowDraft({
    planDate: selectedDate,
    workPackages: wps,
    categoryCodeById,
    baselineFinishByWp,
    crews: crewRes.data ?? [],
    crewMembers: memberRes.data ?? [],
    recentPlanItems,
    recentPlanCrew: recentCrewRows ?? [],
  });

  return shell(
    <DailyPlanBoard
      projects={projects}
      selectedProjectId={selectedProjectId}
      today={today}
      dateIso={selectedDate}
      dateLabel={formatThaiDate(selectedDate)}
      planId={planId}
      leafOptions={leafOptions}
      workers={workers}
      items={items}
      suggestions={draft}
    />,
  );
}
