// Spec 253 U1 — finance project list: every project with its funnel headline
// (billed / received / outstanding) linking into the drill. Server Component;
// money via the admin client behind the MONEY_VIEW_ROLES gate (spec 252 posture).

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { MONEY_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { baht } from "@/lib/format";
import { CARD } from "@/lib/ui/classes";
import { projectReceiptSummary } from "@/lib/accounting/receipts";

export const metadata = { title: "การเงินรายโครงการ" };

export default async function FinanceProjectListPage() {
  const ctx = await requireRole(MONEY_VIEW_ROLES);
  const admin = createAdminClient();

  const [projectRes, billingRes, receiptRes] = await Promise.all([
    admin.from("projects").select("id, code, name, status").order("code"),
    admin.from("client_billings").select("id, project_id, net_receivable, status"),
    admin
      .from("client_receipts")
      .select("id, project_id, client_billing_id, amount, received_date, superseded_by"),
  ]);

  const billingsByProject = new Map<
    string,
    { id: string; netReceivable: number | null; status: string }[]
  >();
  for (const b of billingRes.data ?? []) {
    const arr = billingsByProject.get(b.project_id) ?? [];
    arr.push({
      id: b.id,
      netReceivable: b.net_receivable === null ? null : Number(b.net_receivable),
      status: b.status,
    });
    billingsByProject.set(b.project_id, arr);
  }
  const receiptsByProject = new Map<
    string,
    {
      id: string;
      billingId: string | null;
      amount: number | null;
      receivedDate: string | null;
      supersededBy: string | null;
    }[]
  >();
  for (const r of receiptRes.data ?? []) {
    const arr = receiptsByProject.get(r.project_id) ?? [];
    arr.push({
      id: r.id,
      billingId: r.client_billing_id,
      amount: r.amount === null ? null : Number(r.amount),
      receivedDate: r.received_date,
      supersededBy: r.superseded_by,
    });
    receiptsByProject.set(r.project_id, arr);
  }

  const rows = (projectRes.data ?? []).map((p) => ({
    id: p.id,
    label: p.name ?? p.code,
    code: p.code,
    summary: projectReceiptSummary(
      billingsByProject.get(p.id) ?? [],
      receiptsByProject.get(p.id) ?? [],
    ),
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">การเงินรายโครงการ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {rows.length === 0 ? (
          <EmptyNotice>ยังไม่มีโครงการ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/accounting/projects/${p.id}`} className={`${CARD} block`}>
                  <p className="text-ink mb-1 truncate text-sm font-semibold">{p.label}</p>
                  <div className="text-ink-secondary flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                    <span>
                      วางบิล{" "}
                      <span className="text-ink font-semibold tabular-nums">
                        {baht(p.summary.billed)}
                      </span>
                    </span>
                    <span>
                      รับแล้ว{" "}
                      <span className="text-done-strong font-semibold tabular-nums">
                        {baht(p.summary.received)}
                      </span>
                    </span>
                    <span>
                      ค้างรับ{" "}
                      <span
                        className={`font-semibold tabular-nums ${p.summary.outstanding > 0 ? "text-attn-ink" : "text-ink"}`}
                      >
                        {baht(p.summary.outstanding)}
                      </span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
