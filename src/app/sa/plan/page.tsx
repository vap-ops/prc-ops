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
import { bangkokTodayIso } from "@/lib/dates";
import { addDaysIso } from "@/lib/work-packages/calendar-grid";
import { DAILY_WORK_PLAN_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { buildWpPickerGroups, type WpPickerRow } from "@/lib/work-packages/picker-options";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { DailyPlanBoard, type DailyPlanItemView } from "@/components/features/sa/daily-plan-board";

export const metadata = { title: DAILY_WORK_PLAN_LABEL };

export default async function SaPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const ctx = await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();
  const { project: qProject } = await searchParams;

  const shell = (body: ReactNode) => (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/sa" backLabel="หน้าหลัก">
        <h1 className="text-title text-ink font-bold tracking-tight">{DAILY_WORK_PLAN_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>{body}</div>
    </PageShell>
  );

  // RLS scopes projects to the SA's memberships (can_see_project).
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code");
  const projects = projectRows ?? [];
  if (projects.length === 0) {
    return shell(<EmptyNotice>ยังไม่มีโครงการที่ดูแล</EmptyNotice>);
  }

  const selectedProjectId =
    qProject && UUID_REGEX.test(qProject) && projects.some((p) => p.id === qProject)
      ? qProject
      : projects[0]!.id;
  const tomorrow = addDaysIso(bangkokTodayIso(), 1);

  // Groups (for the picker's section labels) + every leaf; filter to non-complete
  // leaves below. Both levels come from one project-scoped read.
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name, status, is_group, parent_id")
    .eq("project_id", selectedProjectId);
  const wps = wpRows ?? [];

  const { data: workerRows } = await supabase
    .from("workers")
    .select("id, name")
    .eq("project_id", selectedProjectId)
    .eq("active", true)
    .order("name");
  const workers = workerRows ?? [];

  // The existing board for tomorrow (at most one — unique(project, plan_date)).
  const { data: plan } = await supabase
    .from("daily_work_plans")
    .select("id")
    .eq("project_id", selectedProjectId)
    .eq("plan_date", tomorrow)
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

  return shell(
    <DailyPlanBoard
      projects={projects}
      selectedProjectId={selectedProjectId}
      dateIso={tomorrow}
      dateLabel={formatThaiDate(tomorrow)}
      planId={planId}
      leafOptions={leafOptions}
      workers={workers}
      items={items}
    />,
  );
}
