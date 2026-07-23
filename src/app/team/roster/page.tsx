// Spec 334 U2 — /team/roster, the merged team roster. Spec 313 stacked the site
// team board (spec 282) and the staged onboarding roster (spec 279/298) onto the
// /team hub; spec 334 moves the merged board to its own drill-down so the hub can
// stay วันนี้-first. This is a DETAIL page (DetailHeader back chip → /team), not a
// hub — no BottomTabBar/HubNav. Gate = the crew view's audience only (site_admin +
// super_admin, the isCrew pair that renders these components on /team today), NOT
// the full TEAM_PAGE_ROLES — widening it would contradict spec 334's "no role
// gain" (spec U2). Read-only: every query is a granted SELECT/definer read the SA
// already runs on /team; the board's chips (รอ PM ยืนยัน / รอ PM กรอกบัญชี) are
// derived, never written. The queries below are lifted from the hub's isCrew block
// (spec 313 U1) minus the QR-card generation and registration reads, which stay
// hub-side.

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
import { SA_SURFACE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { buildCrewTeams } from "@/lib/sa/crew-teams";
import { buildSiteTeamBoard, type SiteAccessMember } from "@/lib/sa/site-team-board";
import { SiteTeamBoard } from "@/components/features/sa/site-team-board";

export const metadata = { title: "รายชื่อทีม" };

export default async function TeamRosterPage() {
  await requireRole(SA_SURFACE_ROLES);
  const supabase = await createClient();

  // The SA's projects (RLS-scoped via their visible work packages, ADR 0056) →
  // the active workers on those projects (name + the non-money onboarding
  // discriminators cost_confirmed_at/level, all granted reads).
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("project_id")
    .eq("is_group", false);
  const projectIds = Array.from(new Set((wpRows ?? []).map((w) => w.project_id)));
  const today = bangkokTodayIso();

  const [workerRes, crewRes, memberRes, planRes, categoryRes] = await Promise.all([
    projectIds.length
      ? supabase
          .from("workers")
          .select("id, name, project_id, cost_confirmed_at, level, employment_type, contractor_id")
          .eq("active", true)
          .in("project_id", projectIds)
          .order("name")
      : Promise.resolve({ data: null }),
    // Crews on the SA's projects (team dimension). default_day_rate is NOT selected
    // (money zero-grant).
    projectIds.length
      ? supabase
          .from("crews")
          .select("id, name, lead_worker_id, kind")
          .eq("active", true)
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    // Active membership (RLS-scoped to the SA's visible crews). removed_at IS NULL =
    // the current roster.
    projectIds.length
      ? supabase.from("crew_members").select("crew_id, worker_id").is("removed_at", null)
      : Promise.resolve({ data: null }),
    // Upcoming แผนพรุ่งนี้ boards (today onward) — the source of the per-crew งาน label.
    projectIds.length
      ? supabase
          .from("daily_work_plans")
          .select("id")
          .gte("plan_date", today)
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    // project_category id → GLOBAL work-category code (W0x) for the งาน category chip.
    projectIds.length
      ? supabase
          .from("project_categories")
          .select("id, work_categories(code)")
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
  ]);

  // The งาน edge: the SA's upcoming boards → their items → who is on each item →
  // the งานย่อย detail. Fetched after the plans resolve (each read narrows the next
  // by id, so RLS never full-scans). buildCrewTeams maps items↔crew↔WP per crew.
  const planIds = (planRes.data ?? []).map((p) => p.id);
  const itemRes = planIds.length
    ? await supabase
        .from("daily_work_plan_items")
        .select("id, work_package_id")
        .in("plan_id", planIds)
    : { data: null };
  const planItems = itemRes.data ?? [];
  const itemIds = planItems.map((i) => i.id);
  const wpIds = Array.from(new Set(planItems.map((i) => i.work_package_id)));

  const [planCrewRes, wpRes] = await Promise.all([
    itemIds.length
      ? supabase.from("daily_work_plan_crew").select("item_id, worker_id").in("item_id", itemIds)
      : Promise.resolve({ data: null }),
    wpIds.length
      ? supabase.from("work_packages").select("id, code, name, category_id").in("id", wpIds)
      : Promise.resolve({ data: null }),
  ]);
  const planCrew = planCrewRes.data ?? [];

  const categoryCodeById = new Map<string, string>();
  for (const c of categoryRes.data ?? []) {
    const wc = c.work_categories;
    const code = (Array.isArray(wc) ? wc[0]?.code : wc?.code) ?? null;
    if (code) categoryCodeById.set(c.id, code);
  }
  const teamWorkPackages = (wpRes.data ?? []).map((wp) => ({
    id: wp.id,
    code: wp.code,
    name: wp.name,
    categoryCode: (wp.category_id && categoryCodeById.get(wp.category_id)) || null,
  }));

  const workerRows = workerRes.data ?? [];

  // Spec 334 U2 — the รอ PM ยืนยัน chip: active workers a PM has not cost/level-
  // confirmed (cost_confirmed_at IS NULL). On prod today this is most of the roster.
  const costPendingByWorker = new Set(
    workerRows.filter((w) => w.cost_confirmed_at === null).map((w) => w.id),
  );

  // Spec 298 U2 — the รอ PM กรอกบัญชี chip: a phoneless SA-add captured the passbook,
  // awaiting a PM's bank transcription (status-only projection — the SA never sees
  // the photo or the bank fields).
  const bankStatuses = await Promise.all(
    projectIds.map((pid) => supabase.rpc("sa_worker_bank_status", { p_project: pid })),
  );
  const bankPendingByWorker = new Set<string>();
  for (const res of bankStatuses)
    for (const row of res.data ?? [])
      if (row.status === "pending_pm") bankPendingByWorker.add(row.worker_id);

  // The crew (team) lens — the roster grouped by crew: each crew's lead + members
  // (with ประจำ/ชั่วคราว from employment_type) + the งาน it runs. View-only.
  const teamData = buildCrewTeams({
    workers: workerRows.map((w) => ({
      id: w.id,
      name: w.name,
      level: w.level,
      employmentType: w.employment_type,
    })),
    crews: crewRes.data ?? [],
    members: memberRes.data ?? [],
    planItems,
    planCrew,
    workPackages: teamWorkPackages,
  });

  // Spec 282 U2 — the ฝ่ายไซต์ (site-access) bucket = each project's site_admin/
  // site_owner members, via the U1 scoped definer read (an SA can't read other
  // users' role/name directly). Unioned across the SA's projects, deduped by user.
  const siteAccessResults = await Promise.all(
    projectIds.map((pid) => supabase.rpc("project_site_management", { p_project: pid })),
  );
  const siteAccessByUser = new Map<string, string | null>();
  for (const res of siteAccessResults) {
    for (const row of res.data ?? []) siteAccessByUser.set(row.user_id, row.display_name);
  }
  const siteAccess: SiteAccessMember[] = [...siteAccessByUser].map(([userId, name]) => ({
    userId,
    name,
  }));

  const crewKindById = new Map((crewRes.data ?? []).map((c) => [c.id, c.kind]));
  const contractorByWorker = new Map(workerRows.map((w) => [w.id, w.contractor_id]));

  const board = buildSiteTeamBoard({
    teams: teamData.teams,
    unassigned: teamData.unassigned,
    crewKindById,
    contractorByWorker,
    siteAccess,
    costPendingByWorker,
    bankPendingByWorker,
  });

  return (
    <PageShell>
      <DetailHeader backHref="/team" backLabel="ทีมงาน">
        <h1 className={DETAIL_TITLE}>รายชื่อทีม</h1>
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        <SiteTeamBoard board={board} emptyLabel="ยังไม่มีช่างในระบบ — เพิ่มช่างจากหน้าทีมงาน" />
      </section>
    </PageShell>
  );
}
