// Spec 262 U2 — the procurement purchase report. Procurement's wing
// (accounting reaches it too, per the 6-role gate; NOT forked under
// /accounting). Reads purchase_report (spec 262 U1) via the regular server
// client — the RPC's own current_user_role() gate needs the caller's real
// session, not the admin client. Zero client JS: period/bucket/group-by are
// deep-linkable <Link> chips + a plain GET form (the /projects filter-bar
// pattern), so every state is a bookmarkable/shareable URL.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASE_REPORT_ROLES, isProcurementManagerTier } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import {
  CARD,
  SECTION_HEADING,
  FIELD_INPUT,
  FIELD_SELECT,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
} from "@/lib/ui/classes";
import { budgetStatus } from "@/lib/dashboard/spend";
import {
  BUCKET_LABEL,
  GROUP_BY_LABEL,
  PERIOD_PRESET_LABEL,
  REPORT_ALL_TIME_FROM,
  availableGroupByOptions,
  bucketWindow,
  mapReportRow,
  parseReportQuery,
  registerDrillHref,
  reportHref,
  resolvePeriod,
  summarizeReportRows,
  trendByBucket,
  barPct,
  type PurchaseReportRow,
  type ReportRawQuery,
} from "@/lib/purchasing/purchase-report-view";

export const metadata = { title: "รายงานยอดสั่งซื้อ" };

interface ReportsPageProps {
  searchParams: Promise<ReportRawQuery>;
}

export default async function PurchaseReportsPage({ searchParams }: ReportsPageProps) {
  const ctx = await requireRole(PURCHASE_REPORT_ROLES);
  const canSeePurchaser = isProcurementManagerTier(ctx.role);

  const sp = await searchParams;
  const today = bangkokTodayIso();
  const state = parseReportQuery(sp, today, canSeePurchaser);
  const { preset, from, to, bucket, group, projectId } = state;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_report", {
    p_from: from,
    p_to: to,
    p_bucket: bucket,
    p_group_by: group,
    ...(projectId ? { p_project_id: projectId } : {}),
  });
  if (error) throw new Error(`purchase_report: ${error.message}`);
  const rows: PurchaseReportRow[] = (data ?? []).map((r) => mapReportRow(bucket, r));

  const totals = summarizeReportRows(rows);
  const trend = trendByBucket(rows);
  const trendMax = trend.reduce((m, t) => Math.max(m, t.gross), 0);

  const admin = createAdminClient();
  const { data: projectRows } = await admin.from("projects").select("id, code, name").order("name");
  const projects = projectRows ?? [];

  // Budget strip (spec 262 U2): project grain only, cumulative committed
  // spend vs projects.budget_amount_thb (authenticated cannot read that
  // column — admin client, behind this same role gate).
  let budgetSpend: number | null = null;
  let budget: number | null = null;
  if (projectId) {
    const { data: cumulativeRaw } = await supabase.rpc("purchase_report", {
      p_from: REPORT_ALL_TIME_FROM,
      p_to: today,
      p_bucket: "year",
      p_group_by: "project",
      p_project_id: projectId,
    });
    budgetSpend = (cumulativeRaw ?? []).reduce((s, r) => s + r.gross, 0);
    const { data: projectRow } = await admin
      .from("projects")
      .select("budget_amount_thb")
      .eq("id", projectId)
      .maybeSingle();
    budget = projectRow?.budget_amount_thb ?? null;
  }
  const budgetView = budgetSpend !== null ? budgetStatus(budget, budgetSpend) : null;

  const todayRange = resolvePeriod("today", today);
  const monthRange = resolvePeriod("month", today);
  const yearRange = resolvePeriod("year", today);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/requests" backLabel="งานจัดซื้อ">
        <h1 className="text-title text-ink font-bold tracking-tight">รายงานยอดสั่งซื้อ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* Period presets — deep-linkable chips (no client JS). */}
        <div className="mb-3 flex flex-wrap gap-2">
          <Link
            href={reportHref(state, { preset: "today", ...todayRange })}
            aria-pressed={preset === "today"}
            className={`${BUTTON_SECONDARY} ${preset === "today" ? "bg-fill text-on-fill" : ""}`}
          >
            {PERIOD_PRESET_LABEL.today}
          </Link>
          <Link
            href={reportHref(state, { preset: "month", ...monthRange })}
            aria-pressed={preset === "month"}
            className={`${BUTTON_SECONDARY} ${preset === "month" ? "bg-fill text-on-fill" : ""}`}
          >
            {PERIOD_PRESET_LABEL.month}
          </Link>
          <Link
            href={reportHref(state, { preset: "year", ...yearRange })}
            aria-pressed={preset === "year"}
            className={`${BUTTON_SECONDARY} ${preset === "year" ? "bg-fill text-on-fill" : ""}`}
          >
            {PERIOD_PRESET_LABEL.year}
          </Link>
        </div>

        {/* Custom range + project filter — a plain GET form (submitting always
            resolves to preset=custom, the accounting register's convention). */}
        <form
          method="get"
          className={`${CARD} mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end`}
        >
          <input type="hidden" name="bucket" value={bucket} />
          <input type="hidden" name="group" value={group} />
          <input type="hidden" name="preset" value="custom" />
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ตั้งแต่
            <input
              type="date"
              name="from"
              defaultValue={from}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ถึง
            <input
              type="date"
              name="to"
              defaultValue={to}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
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

        {/* Bucket switch. */}
        <div role="group" aria-label="หน่วยเวลา" className="mb-3 flex flex-wrap gap-2">
          {(["day", "month", "year"] as const).map((b) => (
            <Link
              key={b}
              href={reportHref(state, { bucket: b })}
              aria-pressed={bucket === b}
              className={`${BUTTON_SECONDARY} ${bucket === b ? "bg-fill text-on-fill" : ""}`}
            >
              {BUCKET_LABEL[b]}
            </Link>
          ))}
        </div>

        {/* Group-by switch — ผู้สั่งซื้อ only for the manager tier ∪ procurement_manager. */}
        <div role="group" aria-label="จัดกลุ่มตาม" className="mb-6 flex flex-wrap gap-2">
          {availableGroupByOptions(canSeePurchaser).map((g) => (
            <Link
              key={g}
              href={reportHref(state, { group: g })}
              aria-pressed={group === g}
              className={`${BUTTON_SECONDARY} ${group === g ? "bg-fill text-on-fill" : ""}`}
            >
              {GROUP_BY_LABEL[g]}
            </Link>
          ))}
        </div>

        {/* Totals strip — same presentation language as /accounting/purchases. */}
        <div className={`${CARD} mb-6`}>
          <p className="text-ink-secondary text-xs">
            {formatThaiDate(from)} – {formatThaiDate(to)} · {totals.count} ใบขอซื้อ
          </p>
          <dl className="divide-edge mt-2 flex flex-col divide-y">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink-secondary text-sm">มูลค่าก่อนภาษี</dt>
              <dd className="text-ink text-sm font-medium tabular-nums">{baht(totals.net)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink-secondary text-sm">ภาษีมูลค่าเพิ่ม</dt>
              <dd className="text-ink text-sm font-medium tabular-nums">{baht(totals.vat)}</dd>
            </div>
            {totals.chargeGross !== 0 ? (
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-ink-secondary text-sm">รวมค่าขนส่ง/ส่วนลดแล้ว</dt>
                <dd className="text-ink text-sm font-medium tabular-nums">
                  {baht(totals.chargeGross)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink text-sm font-semibold">รวมทั้งสิ้น</dt>
              <dd className="text-ink text-base font-bold tabular-nums">{baht(totals.gross)}</dd>
            </div>
          </dl>
        </div>

        {/* Budget strip — project grain only (spec 262 U2 scope note). */}
        {projectId && budgetView && budgetView.hasBudget ? (
          <div className={`${CARD} mb-6`}>
            <div className="flex items-baseline justify-between">
              <span className="text-ink-secondary text-xs font-semibold">
                ยอดสั่งซื้อสะสมเทียบงบ
              </span>
              <span className="text-ink text-sm font-bold tabular-nums">
                {baht(budgetView.spend)} / {baht(budgetView.budget ?? 0)}
              </span>
            </div>
            <div
              className={`bg-sunk mt-2 h-2 w-full overflow-hidden rounded-full ${budgetView.over ? "ring-danger ring-1" : ""}`}
            >
              <div
                className={`h-full rounded-full ${budgetView.over ? "bg-danger" : "bg-ink"}`}
                style={{ width: `${Math.max(0, Math.min(100, budgetView.pctUsed ?? 0))}%` }}
              />
            </div>
            <p className="text-ink-muted text-meta mt-1">ไม่รวมค่าแรง</p>
          </div>
        ) : null}

        {/* Trend — hand-rolled Tailwind bars (SpendBar family), no chart dependency. */}
        {trend.length > 0 ? (
          <div className={`${CARD} mb-6`}>
            <h2 className={SECTION_HEADING}>แนวโน้ม</h2>
            <ul className="flex flex-col gap-2">
              {trend.map((t) => (
                <li key={t.bucket} className="flex flex-col gap-1">
                  <div className="text-meta flex justify-between gap-3">
                    <span className="text-ink-secondary">{t.bucketLabel}</span>
                    <span className="text-ink font-semibold tabular-nums">{baht(t.gross)}</span>
                  </div>
                  <div className="bg-sunk h-2 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-ink h-full rounded-full"
                      style={{ width: `${barPct(t.gross, trendMax)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mb-4 flex items-center justify-between">
          <h2 className={SECTION_HEADING}>รายละเอียด</h2>
          <Link
            href={reportHref(state, {}, "/requests/reports/export")}
            className={BUTTON_SECONDARY}
          >
            ดาวน์โหลด CSV
          </Link>
        </div>

        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีการจัดซื้อในช่วงนี้</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const window = bucketWindow(bucket, r.bucket);
              const dim = group === "none" ? undefined : group;
              const href = registerDrillHref({
                from: window.from,
                to: window.to,
                ...(dim
                  ? r.groupKey === ""
                    ? { dim, unassigned: true }
                    : { dim, key: r.groupKey }
                  : {}),
              });
              return (
                <li key={`${r.bucket}-${r.groupKey}`} className={CARD}>
                  <Link
                    href={href}
                    className="hover:bg-sunk focus-visible:ring-action -m-1 flex items-center justify-between gap-3 rounded-md p-1 transition-colors focus:outline-none focus-visible:ring-2"
                  >
                    <div className="min-w-0">
                      <p className="text-ink truncate text-sm font-medium">{r.groupLabel}</p>
                      <p className="text-ink-muted text-xs">
                        {r.bucketLabel} · {r.prCount} ใบขอซื้อ
                      </p>
                    </div>
                    <p className="text-ink shrink-0 text-sm font-bold tabular-nums">
                      {baht(r.gross)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
