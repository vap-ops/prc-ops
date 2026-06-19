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
import { rollupProgress } from "@/lib/dashboard/overview";
import { sumMaterials, budgetStatus, type BudgetStatus } from "@/lib/dashboard/spend";
import { aggregateLaborCost, type CostInputRow } from "@/lib/labor/cost";

export const metadata = { title: "ภาพรวม" };

// Live projects only — finished/archived work drops off the overview.
const LIVE_STATUSES = ["active", "on_hold"] as const;

const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

interface ProjectVM {
  id: string;
  name: string;
  code: string;
  total: number;
  complete: number;
  pctComplete: number;
  needsAttention: number;
  money: { spend: number; status: BudgetStatus } | null;
}

export default async function DashboardPage() {
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const isManager = PM_ROLES.includes(ctx.role);
  const supabase = await createServerSupabase();

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
  const materialsByProject = new Map<string, { status: string; amount: number | null }[]>();
  if (isManager && projectIds.length) {
    const admin = createAdminSupabase();
    const wpIds = wps.map((w) => w.id);
    const [{ data: budgetRows }, laborRes, prRes] = await Promise.all([
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
            .select("work_package_id, status, amount")
            .in("work_package_id", wpIds)
        : Promise.resolve({
            data: [] as { work_package_id: string; status: string; amount: number | null }[],
          }),
    ]);
    for (const b of budgetRows ?? []) budgetById.set(b.id, b.budget_amount_thb);
    for (const r of laborRes.data ?? []) {
      const pid = wpProject.get(r.work_package_id);
      if (!pid) continue;
      const arr = laborByProject.get(pid) ?? [];
      arr.push(r);
      laborByProject.set(pid, arr);
    }
    for (const pr of prRes.data ?? []) {
      const pid = wpProject.get(pr.work_package_id);
      if (!pid) continue;
      const arr = materialsByProject.get(pid) ?? [];
      arr.push({ status: pr.status, amount: pr.amount });
      materialsByProject.set(pid, arr);
    }
  }

  const items: ProjectVM[] = projects.map((p) => {
    const progress = rollupProgress(wpsByProject.get(p.id) ?? []);
    let money: ProjectVM["money"] = null;
    if (isManager) {
      const labor = aggregateLaborCost(laborByProject.get(p.id) ?? []).total;
      const materials = sumMaterials(materialsByProject.get(p.id) ?? []);
      const spend = labor + materials;
      money = { spend, status: budgetStatus(budgetById.get(p.id) ?? null, spend) };
    }
    return { id: p.id, name: p.name, code: p.code, ...progress, money };
  });

  const totalBudget = items.reduce((s, i) => s + (i.money?.status.budget ?? 0), 0);
  const totalSpend = items.reduce((s, i) => s + (i.money?.spend ?? 0), 0);

  // Spec 153: the desktop hub strip, like the sibling hubs (/projects, /review).
  // Phones leave via the bottom tab bar.
  const hubItems = hubNavForRole(ctx.role);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {hubItems ? (
        <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/dashboard" />
      ) : null}
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        <h1 className="text-title text-ink font-bold tracking-tight">ภาพรวม</h1>

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
                  ใช้ไปทั้งหมด · ค่าวัสดุนับเฉพาะรายการที่บันทึกราคา
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

function SpendBar({ status }: { status: BudgetStatus }) {
  const pct = status.pctUsed ?? 0;
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="bg-sunk h-2 w-full overflow-hidden rounded-full">
      <div
        className={`h-full rounded-full ${status.over ? "bg-danger" : "bg-done"}`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function ProjectMoney({ money }: { money: { spend: number; status: BudgetStatus } }) {
  const { status, spend } = money;
  return (
    <div className="border-edge mt-3 flex flex-col gap-1 border-t pt-3">
      <div className="text-meta flex justify-between">
        <span className="text-ink-secondary">งบ vs ใช้จริง</span>
        <span className={status.over ? "text-danger font-bold" : "text-ink font-semibold"}>
          {baht(spend)}
          {status.hasBudget
            ? ` / ${baht(status.budget as number)} · ${status.pctUsed}%`
            : " · ยังไม่ตั้งงบ"}
        </span>
      </div>
      {status.hasBudget ? <SpendBar status={status} /> : null}
    </div>
  );
}
