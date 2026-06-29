// Spec 100 — ภาพรวม / Dashboard. A role-aware portfolio overview of live
// projects. EVERY staff role sees the money-free operational half (progress +
// attention); PM/super additionally see budget vs spend (money), read via the
// admin client behind the PM gate — site_admin never sees money (budget/cost
// have zero authenticated grant). A primary-tab hub: BottomTabBar + plain
// header, no back chip (mirrors /settings).

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES, SITE_STAFF_ROLES } from "@/lib/auth/role-home";
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
  budgetStatus,
  type BudgetStatus,
  type SpendBreakdown,
  type SpendBarSegments,
} from "@/lib/dashboard/spend";
import { aggregateLaborCost, type CostInputRow } from "@/lib/labor/cost";
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
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const isManager = PM_ROLES.includes(ctx.role);
  const supabase = await createServerSupabase();

  // Spec 183 U1: the review queue, reframed as awareness on the PM home. Only
  // the PM tier approves, so site_admin (also on this dashboard) gets no card.
  const pendingSummary = isManager
    ? await getPendingApprovalsSummary(supabase)
    : { count: 0, oldest: null };

  // Spec 188: PR is no longer surfaced on ภาพรวม — it owns the คำขอซื้อ tab (with
  // its own badge); double-surfacing it here read as a redundant notification. The
  // dashboard inbox now covers only the tabless approvals: WP review + bank
  // changes.
  // Spec 170 U4c-2: the bank-change card now covers BOTH contractor and worker
  // changes (the merged queue at /contacts/bank-changes); one combined count.
  const pendingBankChanges = isManager
    ? (await getPendingBankChangeCount(supabase)) +
      (await getPendingWorkerBankChangeCount(supabase))
    : 0;

  // Operational reads — user session, SA-readable.
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, name, code, status")
    .in("status", LIVE_STATUSES)
    .order("name", { ascending: true });
  const projects = projectRows ?? [];
  const projectIds = projects.map((p) => p.id);

  const { data: wpRows } = projectIds.length
    ? await supabase
        .from("work_packages")
        .select("id, project_id, status")
        .in("project_id", projectIds)
    : { data: [] };
  const wps = wpRows ?? [];

  const wpProject = new Map(wps.map((w) => [w.id, w.project_id]));
  const wpsByProject = new Map<string, { status: string }[]>();
  for (const w of wps) {
    const arr = wpsByProject.get(w.project_id) ?? [];
    arr.push({ status: w.status });
    wpsByProject.set(w.project_id, arr);
  }

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
  if (isManager && projectIds.length) {
    const admin = createAdminSupabase();
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
      // validated by issue_stock), so group by project_id directly.
      admin.from("stock_issues").select("id, project_id, total_cost").in("project_id", projectIds),
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
      // still-non-reversed issue. Mirrors wp_profit's return netting.
      admin.from("stock_returns").select("project_id, total_cost").in("project_id", projectIds),
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
  }

  const items: ProjectVM[] = projects.map((p) => {
    const progress = rollupProgress(wpsByProject.get(p.id) ?? []);
    let money: ProjectVM["money"] = null;
    if (isManager) {
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
            {isManager ? (
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
