// Spec 380 U3 — ตามเอกสารซื้อ: the chase list. Missing-doc orders grouped by
// supplier (chasing = one call per vendor), oldest debt first, each group
// naming WHAT to ask for per its VAT class (§2 ladder). Rows link to the PR
// detail where the upload affordances already live — this page adds zero new
// write paths. Gated PURCHASING_ROLES = the same set that opens /requests.
import Link from "next/link";

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASING_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import {
  DOC_CHASE_EMPTY_LABEL,
  DOC_CHASE_MISFLAG_HINT,
  DOC_CHASE_TITLE,
  DOC_CHIP_SITE_PAPER,
  DOC_CHIP_VENDOR_DOC,
  DOC_WAIVED_LABEL,
} from "@/lib/i18n/labels";
import { safeBackHref, withBackFrom } from "@/lib/nav/back-href";
import { buildDocChaseView } from "@/lib/purchasing/doc-chase-view";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { loadDocChaseOrders } from "@/lib/purchasing/load-doc-chase";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: DOC_CHASE_TITLE };

interface DocsPageProps {
  searchParams: Promise<{ from?: string | string[] }>;
}

function agingTone(days: number): string {
  if (days > 14) return "text-danger font-bold";
  if (days > 7) return "text-attn-ink font-semibold";
  return "text-ink-secondary";
}

function DocStateChip({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`text-meta rounded-md px-1.5 py-0.5 ${
        present ? "bg-done-soft text-done-ink" : "bg-danger-soft text-danger"
      }`}
    >
      {label} {present ? "✓" : "✗"}
    </span>
  );
}

export default async function DocChasePage({ searchParams }: DocsPageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const sp = await searchParams;

  const supabase = await createClient();
  const { orders, nowMs } = await loadDocChaseOrders(supabase);
  const view = buildDocChaseView(orders, nowMs);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(sp.from, "/procurement")} backLabel="งานจัดซื้อ">
        <h1 className="text-title text-ink font-bold tracking-tight">{DOC_CHASE_TITLE}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-card bg-sunk p-3 text-center">
            <p className="text-title text-ink font-bold">{view.summary.missing}</p>
            <p className="text-meta text-ink-secondary">รอเอกสาร</p>
          </div>
          <div className="rounded-card bg-sunk p-3 text-center">
            <p
              className={`text-title font-bold ${view.summary.over14 > 0 ? "text-danger" : "text-ink"}`}
            >
              {view.summary.over14}
            </p>
            <p className="text-meta text-ink-secondary">เกิน 14 วัน</p>
          </div>
          <div className="rounded-card bg-sunk p-3 text-center">
            <p className="text-title text-ink font-bold">{view.summary.suppliers}</p>
            <p className="text-meta text-ink-secondary">ร้านค้า</p>
          </div>
        </div>

        {view.groups.length === 0 ? (
          // Claims only what the query proves: zero in-scope orders missing docs
          // (waived ones are listed below, not hidden inside this line).
          <EmptyNotice>{DOC_CHASE_EMPTY_LABEL}</EmptyNotice>
        ) : (
          view.groups.map((g) => (
            <details
              key={g.supplier}
              open={g === view.groups[0]}
              className="rounded-card border-edge bg-card shadow-card border"
            >
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="text-body text-ink min-w-0 flex-1 truncate font-semibold">
                  {g.supplier}
                </span>
                <span className="bg-attn-soft text-attn-ink text-meta rounded-full px-2 py-0.5 font-bold">
                  {g.count} รายการ
                </span>
                <span className={`text-meta ${agingTone(g.oldestDays)}`}>
                  เก่าสุด {g.oldestDays} วัน
                </span>
              </summary>
              <div className="border-edge border-t px-4 py-2">
                <p className="text-meta text-ink-secondary py-1">
                  {g.ask}
                  {g.misflagHint ? (
                    <span className="text-attn-ink"> · {DOC_CHASE_MISFLAG_HINT}</span>
                  ) : null}
                </p>
                <ul className="flex flex-col">
                  {g.rows.map((r) => (
                    <li key={r.id} className="border-edge border-t first:border-t-0">
                      <Link
                        href={withBackFrom(`/requests/${r.id}`, "/requests/docs")}
                        className="flex min-h-11 flex-col gap-1 py-2"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-body text-ink min-w-0 truncate">
                            {formatPrNumber(r.prNumber)} · {r.itemDescription}
                          </span>
                          <span className={`text-meta shrink-0 ${agingTone(r.agingDays)}`}>
                            {r.agingDays} วัน
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <DocStateChip label={DOC_CHIP_SITE_PAPER} present={r.hasSitePaper} />
                          <DocStateChip label={DOC_CHIP_VENDOR_DOC} present={r.hasVendorDoc} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))
        )}

        {view.waived.length > 0 ? (
          <details className="rounded-card border-edge bg-sunk border">
            <summary className="text-meta text-ink-secondary flex min-h-11 cursor-pointer list-none items-center px-4 py-2 [&::-webkit-details-marker]:hidden">
              {DOC_WAIVED_LABEL} {view.waived.length} รายการ
            </summary>
            <ul className="border-edge border-t px-4 py-2">
              {view.waived.map((r) => (
                <li key={r.id} className="text-meta text-ink-secondary py-1">
                  {formatPrNumber(r.prNumber)} · {r.itemDescription}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </PageShell>
  );
}
