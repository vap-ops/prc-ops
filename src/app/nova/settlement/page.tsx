// Spec 161 U8 — the settlement + distribution operator surface. super_admin only:
// the pool/split figures (project_settlements, project_coin_distributions) are
// zero-grant economics, read here via the ADMIN client behind requireRole and acted
// on via the SECURITY DEFINER RPCs (settle_project U4b, distribute_project_coins U5)
// through the list's server actions. The close-out lifecycle without SQL.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import {
  NovaSettlementList,
  type SettlementProject,
} from "@/components/features/nova/nova-settlement-list";

export const metadata = { title: "สรุป & แบ่งเหรียญ" };

export default async function NovaSettlementPage() {
  const ctx = await requireRole(["super_admin"]);
  const admin = createAdminClient();

  const [{ data: projectRows }, { data: settlements }, { data: distributions }] = await Promise.all(
    [
      admin.from("projects").select("id, code, name, status").order("code"),
      admin
        .from("project_settlements")
        .select(
          "project_id, coin_pool, banked_profit_total, wp_banked_count, wp_skipped_null_budget_count, equipment_costed",
        ),
      admin
        .from("project_coin_distributions")
        .select("project_id, ht_coins, dc_distributed, dc_count"),
    ],
  );

  const settleBy = new Map((settlements ?? []).map((s) => [s.project_id, s]));
  const distBy = new Map((distributions ?? []).map((d) => [d.project_id, d]));

  // numeric comes back as a string from PostgREST — Number() before the client.
  const projects: SettlementProject[] = (projectRows ?? []).map((p) => {
    const s = settleBy.get(p.id);
    const d = distBy.get(p.id);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      settlement: s
        ? {
            coinPool: Number(s.coin_pool),
            bankedProfitTotal: Number(s.banked_profit_total),
            wpBankedCount: s.wp_banked_count,
            wpSkippedNullBudgetCount: s.wp_skipped_null_budget_count,
            equipmentCosted: s.equipment_costed,
          }
        : null,
      distribution: d
        ? {
            htCoins: Number(d.ht_coins),
            dcDistributed: Number(d.dc_distributed),
            dcCount: d.dc_count,
          }
        : null,
    };
  });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/nova" backLabel="Nova">
        <h1 className="text-title text-ink font-bold tracking-tight">สรุป &amp; แบ่งเหรียญ</h1>
        <p className="text-ink-secondary mt-0.5 text-xs">
          ปิดบัญชีโครงการ → ตั้งกองเหรียญ → แบ่งให้ทีม (ทำครั้งเดียวต่อโครงการ)
        </p>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <NovaSettlementList projects={projects} />
      </section>
    </PageShell>
  );
}
