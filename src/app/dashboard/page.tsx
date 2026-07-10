// Spec 100 — ภาพรวม / Dashboard. A role-aware portfolio overview of live
// projects. EVERY staff role sees the money-free operational half (progress +
// attention); the money-view set (PM tier + accounting, spec 252) additionally
// sees budget vs spend, read via the admin client behind the page gate —
// site_admin never sees money (budget/cost have zero authenticated grant).
// accounting's LIST reads also go via admin: can_see_project has no accounting
// arm (spec 252 leaves RLS untouched — admin-behind-app-gate posture) and this
// page offers accounting no write affordance. A primary-tab hub: BottomTabBar +
// plain header, no back chip (mirrors /settings).

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES, DASHBOARD_VIEW_ROLES, MONEY_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { PendingApprovalsCard } from "@/components/features/dashboard/pending-approvals-card";
import { AwarenessCard } from "@/components/features/dashboard/awareness-card";
import { getPendingApprovalsSummary } from "@/lib/approvals/pending-summary";
import { getPendingBankChangeCount } from "@/lib/approvals/pending-bank-changes";
import { getPendingWorkerBankChangeCount } from "@/lib/approvals/pending-worker-bank-changes";
import { Landmark } from "lucide-react";
import { rollupProgress } from "@/lib/dashboard/overview";
import {
  spendBreakdown,
  spendBarSegments,
  spendByWorkCategory,
  budgetStatus,
  type BudgetStatus,
  type SpendBreakdown,
  type SpendBarSegments,
  type WorkCategorySpend,
} from "@/lib/dashboard/spend";
import { WORK_CATEGORY_UNSET_LABEL } from "@/lib/i18n/labels";
import { bahtCompact as baht } from "@/lib/format";

export const metadata = { title: "ภาพรวม" };

// Live projects only — finished/archived work drops off the overview.
const LIVE_STATUSES = ["active", "on_hold"] as const;

interface ProjectVM {
  id: string;
  name: string;
  code: string;
  total: number;
  complete: number;
  pctComplete: number;
  needsAttention: number;
  money: { breakdown: SpendBreakdown; status: BudgetStatus } | null;
}

export default async function DashboardPage() {
  const ctx = await requireRole(DASHBOARD_VIEW_ROLES);
  const isManager = PM_ROLES.includes(ctx.role);
  // Spec 252: money display = PM tier ∨ accounting (read-only). The approvals /
  // bank-change work-queue cards stay PM-tier (isManager) — work queues, not
  // finance reading.
  const showMoney = MONEY_VIEW_ROLES.includes(ctx.role);
  const supabase = await createServerSupabase();
  // Only accounting needs the admin client now (its project/WP LIST reads — can_see_project
  // has no accounting arm). Money aggregation moved to the DEFINER RPC (via the user client).
  const admin = ctx.role === "accounting" ? createAdminSupabase() : null;
  // accounting has no can_see_project arm — its project/WP lists read via admin
  // behind this page gate.
  const listDb = ctx.role === "accounting" && admin ? admin : supabase;

  // Spec 242: these three opening reads are mutually independent — the approvals
  // summary, the merged bank-change count, and the live-projects list don't depend
  // on each other — so fire them in one wave instead of four serial round-trips. The
  // work_packages + money reads below still chain off projectIds and stay sequential
  // (a genuine data dependency).
  //
  // Spec 183 U1: the review queue, reframed as awareness on the PM home — only the
  // PM tier approves, so site_admin (also on this dashboard) gets no card.
  // Spec 188 / 170 U4c-2: the dashboard inbox surfaces the tabless approvals — WP
  // review + the merged contractor+worker bank-change queue (one combined count). PR
  // is NOT here; it owns the คำขอซื้อ tab + badge.
  const [pendingSummary, pendingBankChanges, projectsRes] = await Promise.all([
    isManager ? getPendingApprovalsSummary(supabase) : Promise.resolve({ count: 0, oldest: null }),
    isManager
      ? Promise.all([
          getPendingBankChangeCount(supabase),
          getPendingWorkerBankChangeCount(supabase),
        ]).then(([contractor, worker]) => contractor + worker)
      : Promise.resolve(0),
    listDb
      .from("projects")
      .select("id, name, code, status")
      .in("status", LIVE_STATUSES)
      .order("name", { ascending: true }),
  ]);
  const projects = projectsRes.data ?? [];
  const projectIds = projects.map((p) => p.id);

  const { data: wpRows } = projectIds.length
    ? await listDb
        .from("work_packages")
        .select("id, project_id, status, category_id")
        .in("project_id", projectIds)
        // Spec 270 U5: progress counts งานย่อย only — a งาน's status is derived
        // FROM them; counting both would double-weight every grouped project.
        .eq("is_group", false)
    : { data: [] };
  const wps = wpRows ?? [];

  const wpsByProject = new Map<string, { status: string }[]>();
  for (const w of wps) {
    const arr = wpsByProject.get(w.project_id) ?? [];
    arr.push({ status: w.status });
    wpsByProject.set(w.project_id, arr);
  }

  // Spec 230 (ADR 0066 / S9): the spend-by-หมวดงาน breakdown (PM tier ∨ accounting). Rows
  // partition the SAME `total` the cards show — no new figure, no double-count.
  let categorySpend: WorkCategorySpend[] = [];

  // Money — PM tier ∨ accounting (spec 252). Perf (U3): the whole portfolio rollup (per
  // project: labor + WP materials + เบิก − returns + store pool; per work-category: the same
  // atoms) is ONE SECURITY DEFINER round-trip — the netting + sort stay in JS. The DEFINER
  // reads the zero-grant cost columns, so this goes via the user-session client.
  const budgetById = new Map<string, number | null>();
  const spendByProjectId = new Map<
    string,
    {
      labor: number;
      materials_purchase: number;
      store_issues: number;
      store_returns: number;
      store_pool: number;
    }
  >();
  if (showMoney && projectIds.length) {
    // ONE round-trip: the DEFINER RPC aggregates the whole live portfolio (per project +
    // per work-category) server-side, replacing the former 10-read admin batch + per-WP JS
    // fold. It reads the zero-grant cost columns as definer, gated to MONEY_VIEW_ROLES.
    const { data: spend } = await supabase.rpc("dashboard_portfolio_spend", {
      p_project_ids: projectIds,
    });
    const rollup = (spend ?? { projects: [], categories: [] }) as {
      projects: Array<{
        project_id: string;
        budget: number | null;
        labor: number;
        materials_purchase: number;
        store_issues: number;
        store_returns: number;
        store_pool: number;
      }>;
      categories: Array<{ work_category_id: string | null; name: string | null; amount: number }>;
    };
    for (const p of rollup.projects) {
      budgetById.set(p.project_id, p.budget);
      spendByProjectId.set(p.project_id, {
        labor: p.labor,
        materials_purchase: p.materials_purchase,
        store_issues: p.store_issues,
        store_returns: p.store_returns,
        store_pool: p.store_pool,
      });
    }
    // Spec 230: the per-work-category atoms partition the SAME portfolio total. Resolve
    // names + sort in JS — spendByWorkCategory folds the unset bucket, drops zero rows,
    // and sorts (amount desc, unset last).
    const nameById = new Map<string, string>();
    for (const c of rollup.categories) {
      if (c.work_category_id && c.name) nameById.set(c.work_category_id, c.name);
    }
    categorySpend = spendByWorkCategory(
      rollup.categories.map((c) => ({ workCategoryId: c.work_category_id, amount: c.amount })),
      nameById,
      WORK_CATEGORY_UNSET_LABEL,
    );
  }

  const items: ProjectVM[] = projects.map((p) => {
    const progress = rollupProgress(wpsByProject.get(p.id) ?? []);
    let money: ProjectVM["money"] = null;
    if (showMoney) {
      const s = spendByProjectId.get(p.id);
      // wpLevel = cost that reached a WP and stayed there: labor + WP materials + เบิก, NET
      // of WP→store returns. projectPool = store stock on hand. Disjoint → the two add to a
      // no-double-count total. The sums come from dashboard_portfolio_spend (above).
      const wpLevel =
        (s?.labor ?? 0) +
        (s?.materials_purchase ?? 0) +
        (s?.store_issues ?? 0) -
        (s?.store_returns ?? 0);
      const breakdown = spendBreakdown(wpLevel, s?.store_pool ?? 0);
      money = {
        breakdown,
        status: budgetStatus(budgetById.get(p.id) ?? null, breakdown.total),
      };
    }
    return { id: p.id, name: p.name, code: p.code, ...progress, money };
  });

  const totalBudget = items.reduce((s, i) => s + (i.money?.status.budget ?? 0), 0);
  const totalSpend = items.reduce((s, i) => s + (i.money?.breakdown.total ?? 0), 0);

  // Spec 153: the desktop hub strip, like the sibling hubs (/projects, /review).
  // Phones leave via the bottom tab bar.
  const hubItems = hubNavForRole(ctx.role);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {hubItems ? (
        <HubNav
          maxWidthClass={PAGE_MAX_W}
          items={hubItems}
          currentHref="/dashboard"
          role={ctx.role}
        />
      ) : null}
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        <h1 className="text-title text-ink font-bold tracking-tight">ภาพรวม</h1>

        {/* Spec 183 U1: pending-approval awareness sits at the top of the PM
            home — the review queue is no longer a tab, it surfaces here. */}
        {isManager ? <PendingApprovalsCard summary={pendingSummary} /> : null}
        {/* Spec 188: the dashboard inbox surfaces the TABLESS approvals — the WP
            รอตรวจ hero (above) + the bank-change card (below). PR is NOT here; it
            owns the คำขอซื้อ tab + badge. These two sum to the ภาพรวม nav badge. */}
        {isManager ? (
          <AwarenessCard
            count={pendingBankChanges}
            label="การเปลี่ยนบัญชีรอการอนุมัติ"
            href="/contacts/bank-changes"
            icon={Landmark}
          />
        ) : null}
        {/* Spec 201: the open-feedback triage count moved OFF this dashboard to
            /settings (feedback 152d2e34) — ภาพรวม is project content, not app-admin
            counts. The count badges the รายการที่แจ้งเข้ามา link in ตั้งค่า. */}

        {items.length === 0 ? (
          <p className="text-ink-secondary text-body">ยังไม่มีโครงการที่กำลังดำเนินการ</p>
        ) : (
          <>
            {showMoney ? (
              <div className="border-edge bg-card shadow-card rounded-card flex flex-col gap-2 border p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink-secondary text-meta font-semibold">งบประมาณรวม</span>
                  <span className="text-ink text-body font-bold">
                    {baht(totalSpend)} / {totalBudget > 0 ? baht(totalBudget) : "—"}
                  </span>
                </div>
                {totalBudget > 0 ? (
                  <SpendBar status={budgetStatus(totalBudget, totalSpend)} />
                ) : null}
                <p className="text-ink-muted text-meta">
                  ใช้ไปทั้งหมด รวมของที่พักในคลังโครงการ · ค่าวัสดุนับเฉพาะรายการที่บันทึกราคา
                </p>
              </div>
            ) : null}

            {/* Spec 230 (ADR 0066 / S9): the spend-by-หมวดงาน lens — partitions the same
                ใช้จริงรวม above. Shown only once at least one WP carries a work-category
                (before adoption every baht would sit in the unset bucket — no signal). */}
            {categorySpend.some((r) => r.workCategoryId !== null) ? (
              <SpendByCategoryCard rows={categorySpend} total={totalSpend} />
            ) : null}

            <ul className="flex flex-col gap-3">
              {items.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/projects/${it.id}`}
                    className="group border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action rounded-card block border p-4 transition-colors focus:outline-none focus-visible:ring-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink text-body font-semibold break-words">{it.name}</p>
                        <p className="text-ink-muted text-meta font-mono">{it.code}</p>
                      </div>
                      {it.needsAttention > 0 ? (
                        <span className="bg-attn text-on-attn text-meta rounded-full px-2 py-0.5 font-semibold whitespace-nowrap">
                          {it.needsAttention} งานต้องดูแล
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-col gap-1">
                      <div className="text-ink-secondary text-meta flex justify-between">
                        <span>ความคืบหน้า</span>
                        <span>
                          {it.complete}/{it.total} งาน · {it.pctComplete}%
                        </span>
                      </div>
                      <ProgressBar pct={it.pctComplete} />
                    </div>

                    {it.money ? <ProjectMoney money={it.money} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </PageShell>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="bg-sunk h-2 w-full overflow-hidden rounded-full">
      {/* completion = the `done` (emerald) token; blue stays reserved for nav */}
      <div className="bg-done h-full rounded-full" style={{ width: `${w}%` }} />
    </div>
  );
}

// The portfolio total spend bar (งบประมาณรวม). Money = ink, never the emerald `done`
// used for progress/completion; danger when over budget.
function SpendBar({ status }: { status: BudgetStatus }) {
  const pct = status.pctUsed ?? 0;
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="bg-sunk h-2 w-full overflow-hidden rounded-full">
      <div
        className={`h-full rounded-full ${status.over ? "bg-danger" : "bg-ink"}`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

// The two-colour spend bar — two DISTINCT hues (not two shades), and a different
// family from the emerald `done` progress bar above it, so money never reads as
// completion. ink = ใช้ในงาน (consumed by work, the dominant segment); attn (amber) =
// พักในคลังโครงการ (paid-for stock still in the store), an accent that draws the eye to
// the parked money. Both contrast strongly against each other and the sunk track in
// light AND dark mode. Over budget keeps both colours but rings the track in danger
// (the total text also turns red).
function SpendSplitBar({ segments }: { segments: SpendBarSegments }) {
  const { wpPct, poolPct, over } = segments;
  return (
    <div
      className={`bg-sunk flex h-2 w-full overflow-hidden rounded-full ${over ? "ring-danger ring-1" : ""}`}
    >
      <div className="bg-ink h-full" style={{ width: `${wpPct}%` }} />
      <div className="bg-attn h-full" style={{ width: `${poolPct}%` }} />
    </div>
  );
}

// Spec 230 (ADR 0066 / S9): the spend-by-หมวดงาน card. One row per work-category, the
// amount being that category's net WP-level spend; the bars are sized relative to the
// largest row (a comparison, not a budget %). Uncategorised spend + the project store
// pool sit in the unset bucket (rendered last by spendByWorkCategory). Money stays the
// ink hue — never the emerald `done` used for progress.
function SpendByCategoryCard({ rows, total }: { rows: WorkCategorySpend[]; total: number }) {
  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0);
  return (
    <div className="border-edge bg-card shadow-card rounded-card flex flex-col gap-3 border p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-ink-secondary text-meta font-semibold">ใช้จริงตามหมวดงาน</span>
        <span className="text-ink text-body font-bold">{baht(total)}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((r.amount / max) * 100))) : 0;
          return (
            <li key={r.workCategoryId ?? "__unset__"} className="flex flex-col gap-1">
              <div className="text-meta flex justify-between gap-3">
                <span className="text-ink-secondary min-w-0 truncate">{r.name}</span>
                <span className="text-ink font-medium tabular-nums">{baht(r.amount)}</span>
              </div>
              <div className="bg-sunk h-1.5 w-full overflow-hidden rounded-full">
                <div className="bg-ink h-full rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-ink-muted text-meta">
        แบ่งยอดใช้จริงรวมตามหมวดงาน · วัสดุในคลังที่ยังไม่เบิกนับรวมใน{WORK_CATEGORY_UNSET_LABEL}
      </p>
    </div>
  );
}

function ProjectMoney({ money }: { money: { breakdown: SpendBreakdown; status: BudgetStatus } }) {
  const { status, breakdown } = money;
  // Always show all three lines — WP-level cost, the project store pool, and the
  // combined total vs budget — so the card reads consistently across projects. The
  // pool line is ฿0 when nothing paid-for is sitting in the store. The first two are
  // colour-keyed to the bar segments below (ink = ใช้ในงาน, amber = คลัง).
  return (
    <div className="border-edge mt-3 flex flex-col gap-1 border-t pt-3">
      <div className="text-meta flex justify-between">
        <span className="text-ink-secondary flex items-center gap-1.5">
          <span aria-hidden className="bg-ink inline-block size-2 rounded-full" />
          ใช้ในงาน
        </span>
        <span className="text-ink font-medium">{baht(breakdown.wpLevel)}</span>
      </div>
      <div className="text-meta flex justify-between">
        <span className="text-ink-secondary flex items-center gap-1.5">
          <span aria-hidden className="bg-attn inline-block size-2 rounded-full" />
          พักในคลังโครงการ
        </span>
        <span className="text-ink font-medium">{baht(breakdown.projectPool)}</span>
      </div>
      <div className="text-meta flex justify-between">
        <span className="text-ink-secondary">ใช้จริงรวม</span>
        <span className={status.over ? "text-danger font-bold" : "text-ink font-semibold"}>
          {baht(breakdown.total)}
          {status.hasBudget
            ? ` / ${baht(status.budget as number)} · ${status.pctUsed}%`
            : " · ยังไม่ตั้งงบ"}
        </span>
      </div>
      {status.hasBudget ? (
        <SpendSplitBar segments={spendBarSegments(breakdown, status.budget)} />
      ) : null}
    </div>
  );
}
