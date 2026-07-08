// Spec 192 U4 → Spec 277 P0 — the site-admin daily home, rebuilt as ONE stable
// scrollable column whose structure never reshuffles by clock:
//   ต้องแก้ (bounced/rework, conditional) → คำขอสมัครรอตรวจ (conditional) →
//   ทีมงานวันนี้ muster → แผนวันนี้ (default surface) → งานของฉัน → เครื่องมือ tiles,
//   with a floating ถ่ายรูป capture FAB.
// Everything here is a shipped feature surfaced in place — no new backend. The
// muster + plan share today's board; the tools tile row un-buries the store,
// schedule, purchase-request and end-of-day surfaces the SA otherwise reaches only
// through the project hub or a settings gear.

import Link from "next/link";
import { Camera, ClipboardList, HardHat, ShoppingCart } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { EmptyNotice } from "@/components/features/common/notices";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { WORK_PACKAGE_STATUS_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { currentLaborLogs } from "@/lib/labor/current-logs";
import { DailyPlanWorklist, type WorklistItem } from "@/components/features/sa/daily-plan-worklist";
import { MusterStrip } from "@/components/features/sa/muster-strip";
import { SaTools } from "@/components/features/sa/sa-tools";
import { CameraFab } from "@/components/features/sa/camera-fab";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { bangkokHour, bangkokTodayIso } from "@/lib/dates";
import { summarizeMuster } from "@/lib/sa/muster";
import { buildSaActionList, type BouncedWp, type ReworkInfo } from "@/lib/sa/action-list";
import { getLatestDecisionsForWorkPackages } from "@/lib/approvals/latest-decision";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";
import { SaActionSection } from "@/components/features/sa/action-section";
import type { ReworkSource } from "@/lib/db/enums";

export const metadata = { title: "หน้าหลัก" };

export default async function SaHomePage() {
  const ctx = await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();
  const today = bangkokTodayIso();

  // RLS scopes work_packages to the SA's member projects (can_see_wp / ADR 0056),
  // so this is already "my" work. Spec 218: keep pending_approval (drop only
  // complete) — a WP the PM bounced (ให้แก้ไข / ไม่อนุมัติ) stays pending_approval
  // but is back on the SA's plate; we surface it from its latest decision.
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, category_id, rework_round")
    // Spec 270 U5: งาน grouping rows are never actionable — leaves only.
    .eq("is_group", false)
    .neq("status", "complete");
  const wps = wpRows ?? [];

  const projectIds = Array.from(new Set(wps.map((w) => w.project_id)));

  // These four reads depend only on projectIds (or nothing) — batch them (specs
  // 147/148). Today's boards, the projects, the work-category taxonomy (to render
  // category identity), and the SA's pending technician-registration queue.
  const [projectRes, planRes, categoryRes, pendingRegistrations] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, code, name").in("id", projectIds)
      : Promise.resolve({ data: null }),
    projectIds.length
      ? supabase
          .from("daily_work_plans")
          .select("id, project_id")
          .eq("plan_date", today)
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    projectIds.length
      ? supabase
          .from("project_categories")
          .select("id, work_categories(code)")
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    // /sa/registrations is a site_admin surface; super_admin uses /registrations.
    ctx.role === "site_admin" ? listVisibleTechnicianRegistrations(supabase) : Promise.resolve([]),
  ]);

  const projects = projectRes.data ?? [];
  const projectsById = new Map(projects.map((p) => [p.id, { code: p.code, name: p.name }]));
  const plans = planRes.data ?? [];
  const planProject = new Map(plans.map((p) => [p.id, p.project_id]));
  const pendingRegCount = pendingRegistrations.length;

  // Spec 277 — project_category id → reconciled GLOBAL work-category code (W0x),
  // so the plan + งานของฉัน cards can render the category letter·color·icon.
  const categoryCodeById = new Map<string, string>();
  for (const c of categoryRes.data ?? []) {
    const wc = c.work_categories;
    const code = (Array.isArray(wc) ? wc[0]?.code : wc?.code) ?? null;
    if (code) categoryCodeById.set(c.id, code);
  }

  // Spec 273 U3 — TODAY's แผนวันนี้ worklist: today's board(s) for the SA's
  // projects, each item's crew, and who is already logged today (present). All
  // reads RLS-scoped (can_see_project); logging is the existing log_labor_day.
  let worklistItems: WorklistItem[] = [];
  if (plans.length > 0) {
    const { data: planItemRows } = await supabase
      .from("daily_work_plan_items")
      .select("id, plan_id, work_package_id, sort_order")
      .in(
        "plan_id",
        plans.map((p) => p.id),
      )
      .order("sort_order");
    const planItems = planItemRows ?? [];
    const { data: crewRows } = planItems.length
      ? await supabase
          .from("daily_work_plan_crew")
          .select("item_id, worker_id, is_lead")
          .in(
            "item_id",
            planItems.map((i) => i.id),
          )
      : { data: [] };
    const crew = crewRows ?? [];
    const planWpIds = Array.from(new Set(planItems.map((i) => i.work_package_id)));
    const crewWorkerIds = Array.from(new Set(crew.map((c) => c.worker_id)));

    const { data: labelRows } = planWpIds.length
      ? await supabase
          .from("work_packages")
          .select("id, code, name, category_id")
          .in("id", planWpIds)
      : { data: [] };
    const labelById = new Map(
      (labelRows ?? []).map((w) => [
        w.id,
        { code: w.code, name: w.name, categoryId: w.category_id },
      ]),
    );
    const { data: crewWorkerRows } = crewWorkerIds.length
      ? await supabase.from("workers").select("id, name").in("id", crewWorkerIds)
      : { data: [] };
    const workerNameById = new Map((crewWorkerRows ?? []).map((w) => [w.id, w.name]));

    const { data: laborRows } =
      planWpIds.length && crewWorkerIds.length
        ? await supabase
            .from("labor_logs")
            .select(
              "id, work_package_id, worker_id, work_date, day_fraction, worker_name_snapshot, pay_type_snapshot, entered_by, self_logged, superseded_by, correction_reason, created_at, note",
            )
            .eq("work_date", today)
            .in("work_package_id", planWpIds)
            .in("worker_id", crewWorkerIds)
        : { data: [] };
    const present = new Set(
      currentLaborLogs(laborRows ?? []).map((l) => `${l.work_package_id}:${l.worker_id}`),
    );

    const multiProject = projectIds.length > 1;
    worklistItems = planItems.map((i) => {
      const label = labelById.get(i.work_package_id);
      const projectCode = projectsById.get(planProject.get(i.plan_id) ?? "")?.code;
      const categoryId = label?.categoryId ?? null;
      return {
        id: i.id,
        workPackageId: i.work_package_id,
        code: label?.code ?? "",
        name: label?.name ?? "",
        categoryCode: (categoryId && categoryCodeById.get(categoryId)) || null,
        ...(multiProject && projectCode ? { projectLabel: projectCode } : {}),
        crew: crew
          .filter((c) => c.item_id === i.id)
          .map((c) => ({
            workerId: c.worker_id,
            name: workerNameById.get(c.worker_id) ?? "",
            present: present.has(`${i.work_package_id}:${c.worker_id}`),
          })),
      };
    });
  }

  // pending_approval WPs whose LATEST decision is negative = the PM bounced them
  // back to the SA (spec 218). One read per the latest-decision pattern.
  const pendingWps = wps.filter((w) => w.status === "pending_approval");
  const latestDecisions = pendingWps.length
    ? await getLatestDecisionsForWorkPackages(
        supabase,
        pendingWps.map((w) => w.id),
      )
    : new Map();
  const bounced: BouncedWp[] = pendingWps.flatMap((w) => {
    const dec = latestDecisions.get(w.id);
    if (dec?.decision === "needs_revision" || dec?.decision === "rejected") {
      return [{ wp: w, decision: dec.decision, comment: dec.comment }];
    }
    return [];
  });

  // rework WPs: the latest reopen audit row carries the current reason + source
  // (spec 216/217); the round is on the WP itself.
  const reworkWps = wps.filter((w) => w.status === "rework");
  const reworkInfo = new Map<string, ReworkInfo>();
  if (reworkWps.length) {
    const { data: reopenRows } = await supabase
      .from("audit_log")
      .select("target_id, payload")
      .in(
        "target_id",
        reworkWps.map((w) => w.id),
      )
      .eq("payload->>event", "wp_reopened_for_defect")
      .order("created_at", { ascending: false });
    for (const w of reworkWps) {
      const p = (reopenRows ?? []).find((r) => r.target_id === w.id)?.payload as {
        reason?: string;
        source?: ReworkSource;
      } | null;
      reworkInfo.set(w.id, {
        reason: p?.reason ?? null,
        source: p?.source === "client" || p?.source === "internal" ? p.source : null,
        round: w.rework_round,
      });
    }
  }

  const inPlay = wps.filter((w) => w.status !== "pending_approval");
  const { actions, rest } = buildSaActionList({
    inPlay,
    bounced,
    reworkInfo,
    projectsById,
    categoryCodeById,
  });
  const items = rest;
  const hubItems = hubNavForRole(ctx.role);

  const muster = summarizeMuster(worklistItems);
  const showCloseNudge = bangkokHour() >= 16;
  const primaryProjectId = projectIds.length === 1 ? projectIds[0]! : null;
  const captureWps = items.map((it) => ({
    id: it.id,
    projectId: it.projectId,
    code: it.code,
    name: it.name,
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {hubItems ? (
        <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/sa" role={ctx.role} />
      ) : null}
      {/* pb clears the floating capture FAB (fixed, bottom-right) so the last
          tile stays tappable when scrolled to the end. */}
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 pt-6 pb-28`}>
        <div>
          <p className="text-ink-secondary text-meta">{formatThaiDate(today)}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            สวัสดี{ctx.fullName ? ` ${ctx.fullName}` : ""}
          </h1>
        </div>

        {/* 1 · ต้องแก้ไข — WPs the PM/defect bounced back (spec 218), pinned top,
            color-coded, one tap to the capture. Renders nothing when empty. */}
        <SaActionSection items={actions} />

        {/* คำขอสมัครรอตรวจ — surfaces the otherwise-orphan /sa/registrations queue
            with a live count. Only for site_admin (super_admin uses /registrations). */}
        {pendingRegCount > 0 ? (
          <Link
            href="/sa/registrations"
            className="rounded-card border-edge bg-card shadow-card focus-visible:ring-action hover:bg-sunk flex items-center gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
          >
            <ClipboardList aria-hidden className="text-action size-5 shrink-0" />
            <span className="text-body text-ink min-w-0 flex-1 font-medium">มีคำขอสมัครรอตรวจ</span>
            <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
              {pendingRegCount}
            </span>
          </Link>
        ) : null}

        {/* 2 · ทีมงานวันนี้ muster — the plan's crew folded to one line. Above the
            plan; renders nothing on a day with no board. */}
        <MusterStrip summary={muster} dateIso={today} />

        {/* 3 · แผนวันนี้ (default surface) — today's board, one-tap มาทำ. */}
        <DailyPlanWorklist
          dateIso={today}
          dateLabel={formatThaiDate(today)}
          items={worklistItems}
        />

        {/* 4 · เครื่องมือ — moved ABOVE งานของฉัน (temporary): the long WP list was
            burying the tool tiles, so the menu (incl. the new ทีมงาน onboarding tile)
            now sits right under the plan, always reachable without scrolling the list. */}
        <SaTools primaryProjectId={primaryProjectId} showCloseNudge={showCloseNudge} />

        {/* 5 · งานของฉัน — active leaf WPs, each with its category identity. */}
        <div className="flex flex-col gap-3">
          <h2 className="text-meta text-ink-secondary font-semibold">งานของฉัน</h2>
          {items.length === 0 ? (
            <EmptyNotice>
              ยังไม่มีงานที่ต้องดูแล — เริ่มจาก{" "}
              <Link
                href="/projects"
                className="text-action font-medium underline-offset-2 hover:underline"
              >
                โครงการ
              </Link>
            </EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((it) => (
                <li key={it.id} className="rounded-card border-edge bg-card shadow-card border p-4">
                  <Link
                    href={withBackFrom(workPackageHref(it.projectId, it.id), "/sa")}
                    className="focus-visible:ring-action rounded-control block focus:outline-none focus-visible:ring-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink text-body font-semibold break-words">{it.name}</p>
                        <p className="text-ink-muted text-meta">
                          <WpCategoryCode code={it.code} categoryCode={it.categoryCode} />
                          {it.projectCode ? ` · ${it.projectCode} ${it.projectName}` : ""}
                        </p>
                      </div>
                      <span
                        className={`text-meta shrink-0 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${workPackageStatusPillClasses(it.status)}`}
                      >
                        {WORK_PACKAGE_STATUS_LABEL[it.status]}
                      </span>
                    </div>
                  </Link>

                  <div className="mt-3 flex gap-2">
                    <ActionChip
                      href={withBackFrom(
                        `${workPackageHref(it.projectId, it.id)}#wp-photos`,
                        "/sa",
                      )}
                      icon={Camera}
                      label="รูปถ่าย"
                    />
                    <ActionChip
                      href={withBackFrom(`${workPackageHref(it.projectId, it.id)}#wp-labor`, "/sa")}
                      icon={HardHat}
                      label="ทีมงาน"
                    />
                    <ActionChip
                      href={withBackFrom(
                        `${workPackageHref(it.projectId, it.id)}#wp-requests`,
                        "/sa",
                      )}
                      icon={ShoppingCart}
                      label="คำขอซื้อ"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Floating ถ่ายรูป capture — always reachable, never scrolls away. */}
      <CameraFab wps={captureWps} />
    </PageShell>
  );
}

function ActionChip({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Camera;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="border-edge bg-page text-ink-secondary hover:bg-sunk focus-visible:ring-action rounded-control text-meta flex h-11 flex-1 items-center justify-center gap-1.5 border font-medium transition-colors focus:outline-none focus-visible:ring-2"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </Link>
  );
}
