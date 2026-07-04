// Spec 262 U3 — the PO list (ตรวจสอบย้อนหลัง / audit lookback). PO detail
// exists (spec 134) but there was no list; filterable by supplier/project/
// period, one row per PO with its derived status + charges-aware grand total
// + aging (undelivered POs only). Gated PO_DETAIL_VIEW_ROLES — the SAME set
// that already opens a PO's detail, so every row here links somewhere the
// viewer can actually open (no new gate constant, no auth-path touch).

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { PO_DETAIL_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate } from "@/lib/i18n/labels";
import { PURCHASE_ORDER_STATUS_LABEL } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { CARD, FIELD_INPUT, FIELD_SELECT, BUTTON_PRIMARY } from "@/lib/ui/classes";
import { purchaseOrderStatusPillClasses } from "@/lib/status-colors";
import { purchaseOrderStatusIcon } from "@/lib/status-icons";
import { PoNumberTag } from "@/components/features/purchasing/po-number-tag";
import { withBackFrom } from "@/lib/nav/back-href";
import { loadPurchaseOrderList } from "@/lib/purchasing/load-po-list";
import { filterPoRows, sortPoRowsByOrderedAtDesc } from "@/lib/purchasing/po-list-view";

export const metadata = { title: "ใบสั่งซื้อ" };

interface OrdersPageProps {
  searchParams: Promise<{
    supplier?: string;
    project?: string;
    from?: string;
    to?: string;
    pending?: string;
  }>;
}

export default async function PurchaseOrdersPage({ searchParams }: OrdersPageProps) {
  const ctx = await requireRole(PO_DETAIL_VIEW_ROLES);
  const sp = await searchParams;
  const supplierId = sp.supplier || undefined;
  const projectId = sp.project || undefined;
  const from = sp.from || undefined;
  const to = sp.to || undefined;
  const pendingOnly = sp.pending === "1";

  const admin = createAdminClient();
  const [{ data: supplierRows }, { data: projectRows }] = await Promise.all([
    admin.from("suppliers").select("id, name").order("name"),
    admin.from("projects").select("id, code, name").order("name"),
  ]);
  const suppliers = supplierRows ?? [];
  const projects = projectRows ?? [];

  const loaded = await loadPurchaseOrderList(admin, {
    ...(supplierId ? { supplierId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const rows = sortPoRowsByOrderedAtDesc(
    filterPoRows(loaded, { ...(projectId ? { projectId } : {}), pendingOnly }),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/requests" backLabel="งานจัดซื้อ">
        <h1 className="text-title text-ink font-bold tracking-tight">ใบสั่งซื้อ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <form
          method="get"
          className={`${CARD} mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end`}
        >
          {pendingOnly ? <input type="hidden" name="pending" value="1" /> : null}
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ตั้งแต่
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ถึง
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ผู้ขาย
            <select
              name="supplier"
              defaultValue={supplierId ?? ""}
              className={`${FIELD_SELECT} mt-1 max-w-full`}
            >
              <option value="">ทุกผู้ขาย</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            โครงการ
            <select
              name="project"
              defaultValue={projectId ?? ""}
              className={`${FIELD_SELECT} mt-1 max-w-full`}
            >
              <option value="">ทุกโครงการ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.code}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            ดูข้อมูล
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีใบสั่งซื้อตามเงื่อนไขนี้</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id} className={CARD}>
                <Link
                  href={withBackFrom(`/requests/orders/${r.id}`, "/requests/orders")}
                  className="hover:bg-sunk focus-visible:ring-action -m-1 flex flex-col gap-2 rounded-md p-1 transition-colors focus:outline-none focus-visible:ring-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <PoNumberTag poNumber={r.poNumber} />
                    <StatusPill
                      pillClasses={purchaseOrderStatusPillClasses(r.status)}
                      icon={purchaseOrderStatusIcon(r.status)}
                    >
                      {PURCHASE_ORDER_STATUS_LABEL[r.status]}
                    </StatusPill>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink truncate text-sm font-medium">{r.supplierLabel}</p>
                      <p className="text-ink-muted text-xs">
                        {r.projectLabel} · {r.lineCount} รายการ
                        {r.orderedAt ? ` · สั่งซื้อ ${formatThaiDate(r.orderedAt)}` : ""}
                        {r.agingDays !== null ? ` · รอมาแล้ว ${r.agingDays} วัน` : ""}
                      </p>
                    </div>
                    <p className="text-ink shrink-0 text-sm font-bold tabular-nums">
                      {baht(r.total)}
                    </p>
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
