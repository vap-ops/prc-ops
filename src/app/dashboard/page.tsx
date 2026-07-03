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
  sumMaterials,
  sumStoreIssues,
  sumStoreReturns,
  sumStorePool,
  spendBreakdown,
  spendBarSegments,
  spendByWorkCategory,
  budgetStatus,
  type BudgetStatus,
  type SpendBreakdown,
  type SpendBarSegments,
  type WorkCategorySpend,
} from "@/lib/dashboard/spend";
import { aggregateLaborCost, type CostInputRow } from "@/lib/labor/cost";
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
  const admin = showMoney ? createAdminSupabase() : null;
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
    : { data: [] };
  const wps = wpRows ?? [];

  const wpProject = new Map(wps.map((w) => [w.id, w.project_id]));
  // Spec 230 (ADR 0066 / S9): each WP's bound project-category, for the
  // spend-by-หมวดงาน card. Resolved to a global work_category below.
  const wpCategory = new Map(wps.map((w) => [w.id, w.category_id]));
  const wpsByProject = new Map<string, { status: string }[]>();
  for (const w of wps) {
    const arr = wpsByProject.get(w.project_id) ?? [];
    arr.push({ status: w.status });
    wpsByProject.set(w.project_id, arr);
  }

  // Spec 230 (ADR 0066 / S9): the spend-by-หมวดงาน breakdown (PM/super only). Rows
  // partition the SAME `total` the cards already show — no new figure, no double-count.
  let categorySpend: WorkCategorySpend[] = [];

  // Money — PM/super only, admin client (RLS-bypass for the zero-grant cols).
  const budgetById = new Map<string, number | null>();
  const laborByProject = new Map<string, CostInputRow[]>();
  const materialsByProject = new Map<
    string,
    { id: string; status: string; amount: number | null }[]
  >();
  // Spec 195 follow-up — store-issued (เบิก) cost, grouped by project. Disjoint
  // from materialsByProject (WP-less store-bound PRs are excluded there).
  const storeIssuesByProject = new Map<string, { total_cost: number | null }[]>();
  // PD money split — project store pool (stock currently on hand), at cost via
  // stock_on_hand.total_value, grouped by project. Issued material has left
  // stock_on_hand, so this is disjoint from storeIssuesByProject — PROVIDED returns
  // are netted out of the WP level (see storeReturnsByProject).
  const storePoolByProject = new Map<string, { total_value: number | null }[]>();
  // PD money split — WP→store returns (spec 209), grouped by project. A return
  // restores on-hand value (→ storePoolByProject) but leaves its issue non-reversed
  // (→ still in storeIssuesByProject), so its cost must be netted OUT of the WP level
  // to avoid double-counting. Mirrors wp_profit's return netting.
  const storeReturnsByProject = new Map<string, { total_cost: number | null }[]>();
  // Store-first U4 — PR ids whose goods entered the store (a stock_receipt links
  // back to them). Their cost is counted at เบิก (sumStoreIssues), so they are
  // excluded from sumMaterials to avoid a double-count once U1 auto-stocks
  // WP-bound receives. Empty today (the trigger only stocks WP-less PRs).
  const storedPrIds = new Set<string>();
  if (showMoney && admin && projectIds.length) {
    const wpIds = wps.map((w) => w.id);
    const [
      { data: budgetRows },
      laborRes,
      prRes,
      issuesRes,
      reversalsRes,
      receiptsRes,
      poolRes,
      returnsRes,
      projCatsRes,
      workCatsRes,
    ] = await Promise.all([
      admin.from("projects").select("id, budget_amount_thb").in("id", projectIds),
      wpIds.length
        ? admin
            .from("labor_logs")
            .select(
              "id, worker_id, work_date, day_fraction, day_rate_snapshot, worker_type_snapshot, worker_name_snapshot, self_logged, superseded_by, work_package_id",
            )
            .in("work_package_id", wpIds)
        : Promise.resolve({ data: [] as (CostInputRow & { work_package_id: string })[] }),
      wpIds.length
        ? admin
            .from("purchase_requests")
            .select("id, work_package_id, status, amount")
            .in("work_package_id", wpIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              work_package_id: string;
              status: string;
              amount: number | null;
            }[],
          }),
      // Store issues are project-scoped (project_id is set + WP-in-project
      // validated by issue_stock), so group by project_id directly. work_package_id
      // (spec 230) tags the issue's WP for the spend-by-หมวดงาน card.
      admin
        .from("stock_issues")
        .select("id, project_id, total_cost, work_package_id")
        .in("project_id", projectIds),
      // Reversed issues never charged a WP — exclude them (matches wp_profit). A
      // stock_reversals row may target a receipt OR an issue; issue_id is null for
      // receipt reversals, so filter to the issue-reversal rows.
      admin.from("stock_reversals").select("issue_id").not("issue_id", "is", null),
      // Store-first U4 — receipts that link back to a PR mark goods that entered
      // the store; those PRs are counted at เบิก, not here. (No-op pre-U1.)
      admin
        .from("stock_receipts")
        .select("purchase_request_id")
        .in("project_id", projectIds)
        .not("purchase_request_id", "is", null),
      // PD money split — store stock currently on hand, at cost. total_value is the
      // live maintained balance (receipts/returns add, issues subtract, reversals
      // restore), so summing it per project gives the pool value with no separate
      // reversal handling needed.
      admin.from("stock_on_hand").select("project_id, total_value").in("project_id", projectIds),
      // PD money split — WP→store returns, netted out of the WP level so returned
      // material (which restores on-hand value above) is not also counted via its
      // still-non-reversed issue. Mirrors wp_profit's return netting. work_package_id
      // (spec 230) tags the originating WP for the spend-by-หมวดงาน card.
      admin
        .from("stock_returns")
        .select("project_id, total_cost, work_package_id")
        .in("project_id", projectIds),
      // Spec 230: WP → project-category → global work-category, for the
      // spend-by-หมวดงาน card (name resolved firm-wide so categories aggregate across
      // projects). Not money — but read here alongside the money so the card is built
      // only for the manager tier.
      admin.from("project_categories").select("id, work_category_id").in("project_id", projectIds),
      admin.from("work_categories").select("id, name_th"),
    ]);
    for (const b of budgetRows ?? []) budgetById.set(b.id, b.budget_amount_thb);
    for (const r of receiptsRes.data ?? []) {
      if (r.purchase_request_id) storedPrIds.add(r.purchase_request_id);
    }
    const reversedIssueIds = new Set(
      (reversalsRes.data ?? []).map((r) => r.issue_id).filter((id): id is string => id != null),
    );
    for (const si of issuesRes.data ?? []) {
      if (reversedIssueIds.has(si.id)) continue;
      const arr = storeIssuesByProject.get(si.project_id) ?? [];
      arr.push({ total_cost: si.total_cost });
      storeIssuesByProject.set(si.project_id, arr);
    }
    for (const soh of poolRes.data ?? []) {
      const arr = storePoolByProject.get(soh.project_id) ?? [];
      arr.push({ total_value: soh.total_value });
      storePoolByProject.set(soh.project_id, arr);
    }
    for (const rt of returnsRes.data ?? []) {
      const arr = storeReturnsByProject.get(rt.project_id) ?? [];
      arr.push({ total_cost: rt.total_cost });
      storeReturnsByProject.set(rt.project_id, arr);
    }
    for (const r of laborRes.data ?? []) {
      const pid = wpProject.get(r.work_package_id);
      if (!pid) continue;
      const arr = laborByProject.get(pid) ?? [];
      arr.push(r);
      laborByProject.set(pid, arr);
    }
    for (const pr of prRes.data ?? []) {
      // Spec 195 P1: a WP-less PR has no WP to attribute to here (its cost lands
      // at เบิก, not purchase, ADR 0063) — skip it from WP-grouped materials.
      const pid = pr.work_package_id ? wpProject.get(pr.work_package_id) : undefined;
      if (!pid) continue;
      const arr = materialsByProject.get(pid) ?? [];
      arr.push({ id: pr.id, status: pr.status, amount: pr.amount });
      materialsByProject.set(pid, arr);
    }

    // Spec 230: tag each WP-level spend atom with its work-category. The atoms are
    // exactly the pieces of the portfolio total below (per WP: labor + WP materials +
    // เบิก − returns; plus the project store pool, which has no WP), so the card
    // partitions the SAME total — a true breakdown, no double-count.
    const projCatToWorkCat = new Map<string, string | null>();
    for (const pc of projCatsRes.data ?? []) projCatToWorkCat.set(pc.id, pc.work_category_id);
    const workCatName = new Map<string, string>();
    for (const wc of workCatsRes.data ?? []) workCatName.set(wc.id, wc.name_th);
    const wpWorkCat = (wpId: string): string | null => {
      const pc = wpCategory.get(wpId);
      return pc ? (projCatToWorkCat.get(pc) ?? null) : null;
    };

    const atoms: { workCategoryId: string | null; amount: number }[] = [];
    // labor, per WP (supersession is within-WP, so per-WP sums match the project sum).
    const laborByWp = new Map<string, CostInputRow[]>();
    for (const r of laborRes.data ?? []) {
      const arr = laborByWp.get(r.work_package_id) ?? [];
      arr.push(r);
      laborByWp.set(r.work_package_id, arr);
    }
    for (const [wpId, rows] of laborByWp) {
      atoms.push({ workCategoryId: wpWorkCat(wpId), amount: aggregateLaborCost(rows).total });
    }
    // WP-bound material purchases, per WP (store-routed PRs excluded — counted at เบิก).
    const matByWp = new Map<string, { id: string; status: string; amount: number | null }[]>();
    for (const pr of prRes.data ?? []) {
      // The query is WP-bound (.in work_package_id), but the column is nullable —
      // skip any WP-less row (its cost lands at เบิก, not here; matches above).
      if (!pr.work_package_id) continue;
      const arr = matByWp.get(pr.work_package_id) ?? [];
      arr.push({ id: pr.id, status: pr.status, amount: pr.amount });
      matByWp.set(pr.work_package_id, arr);
    }
    for (const [wpId, rows] of matByWp) {
      atoms.push({ workCategoryId: wpWorkCat(wpId), amount: sumMaterials(rows, storedPrIds) });
    }
    // เบิก (store issues), per WP, excluding reversed issues (matches the project sum).
    const issByWp = new Map<string, { total_cost: number | null }[]>();
    for (const si of issuesRes.data ?? []) {
      if (reversedIssueIds.has(si.id)) continue;
      const arr = issByWp.get(si.work_package_id) ?? [];
      arr.push({ total_cost: si.total_cost });
      issByWp.set(si.work_package_id, arr);
    }
    for (const [wpId, rows] of issByWp) {
      atoms.push({ workCategoryId: wpWorkCat(wpId), amount: sumStoreIssues(rows) });
    }
    // WP→store returns, per WP — a NEGATIVE atom, netted out of the WP level (wp_profit).
    const retByWp = new Map<string, { total_cost: number | null }[]>();
    for (const rt of returnsRes.data ?? []) {
      const arr = retByWp.get(rt.work_package_id) ?? [];
      arr.push({ total_cost: rt.total_cost });
      retByWp.set(rt.work_package_id, arr);
    }
    for (const [wpId, rows] of retByWp) {
      atoms.push({ workCategoryId: wpWorkCat(wpId), amount: -sumStoreReturns(rows) });
    }
    // The project store pool has no WP → the unset bucket.
    let poolTotal = 0;
    for (const rows of storePoolByProject.values()) poolTotal += sumStorePool(rows);
    if (poolTotal !== 0) atoms.push({ workCategoryId: null, amount: poolTotal });

    categorySpend = spendByWorkCategory(atoms, workCatName, WORK_CATEGORY_UNSET_LABEL);
  }

  const items: ProjectVM[] = projects.map((p) => {
    const progress = rollupProgress(wpsByProject.get(p.id) ?? []);
    let money: ProjectVM["money"] = null;
    if (showMoney) {
      const labor = aggregateLaborCost(laborByProject.get(p.id) ?? []).total;
      // Materials = direct WP-bound purchases (at supplier amount) + store-issued
      // material (เบิก at cost). Disjoint sources, so additive — no double-count:
      // store-routed PRs (storedPrIds) are dropped from the purchase sum since
      // their cost is counted via the เบิก sum instead.
      const materials =
        sumMaterials(materialsByProject.get(p.id) ?? [], storedPrIds) +
        sumStoreIssues(storeIssuesByProject.get(p.id) ?? []);
      // wpLevel = cost that reached a WP and stayed there: the old figure (labor +
      // materials) NET of WP→store returns (returned material moved back into the
      // store pool below, so it must leave the WP level or it double-counts).
      // projectPool = store stock currently on hand. Disjoint, so the two add to a
      // no-double-count total that also corrects the old understated number.
      const returns = sumStoreReturns(storeReturnsByProject.get(p.id) ?? []);
      const wpLevel = labor + materials - returns;
      const projectPool = sumStorePool(storePoolByProject.get(p.id) ?? []);
      const breakdown = spendBreakdown(wpLevel, projectPool);
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
