// Spec 262 U2 — pure presentation/query layer for the procurement report
// (/requests/reports). Everything here is IO-free: bucket labels, period
// presets, the bucket→calendar-window mapping the register drill needs
// (Asia/Bangkok, matching the purchase_report RPC's bucketing — deviates
// from the accounting register's UTC date filter, spec 262 U1 tz carry-over),
// satang-safe totals, per-bucket trend aggregation, purchaser-slice
// visibility narrowing, and the deep-linkable href builders (no client JS —
// the /projects filter-bar pattern: plain <Link> chips + GET forms).

import { formatThaiDate } from "@/lib/i18n/labels";
import { THAI_MONTHS } from "@/lib/work-packages/gantt-scale";
import { ISO_DATE_REGEX } from "@/lib/dates";

/** Budget-strip cumulative floor — the earliest date the "ยอดสั่งซื้อสะสม"
 * (cumulative committed spend) window looks back to. Well before any real
 * purchase data; a practical "all committed purchases to date" bound, not a
 * business-meaningful epoch. */
export const REPORT_ALL_TIME_FROM = "2020-01-01";

export type ReportBucket = "day" | "month" | "year";
export type ReportGroupBy = "project" | "supplier" | "category" | "purchaser" | "none";
export type PeriodPreset = "today" | "month" | "year" | "custom";

export const BUCKET_LABEL: Record<ReportBucket, string> = {
  day: "วัน",
  month: "เดือน",
  year: "ปี",
};

export const GROUP_BY_LABEL: Record<ReportGroupBy, string> = {
  none: "ทั้งหมด",
  project: "โครงการ",
  supplier: "ผู้ขาย",
  category: "หมวดวัสดุ",
  purchaser: "ผู้สั่งซื้อ",
};

export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  today: "วันนี้",
  month: "เดือนนี้",
  year: "ปีนี้",
  custom: "กำหนดเอง",
};

/** A bucket's date label — day delegates to formatThaiDate; month/year use
 * the Thai short month + Buddhist year (gantt-scale's THAI_MONTHS). */
export function bucketLabel(bucket: ReportBucket, iso: string): string {
  if (bucket === "day") return formatThaiDate(iso);
  const [yStr, mStr] = iso.split("-");
  const beYear = Number(yStr) + 543;
  if (bucket === "year") return String(beYear);
  const monthIndex = Number(mStr) - 1;
  return `${THAI_MONTHS[monthIndex]} ${beYear}`;
}

export interface ReportPeriod {
  from: string;
  to: string;
}

function lastDayOfMonth(year: number, month1based: number): number {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

/** The Asia/Bangkok calendar span a bucket VALUE covers — used to build the
 * register-drill window for a table row. */
export function bucketWindow(bucket: ReportBucket, iso: string): ReportPeriod {
  if (bucket === "day") return { from: iso, to: iso };
  const [yStr, mStr] = iso.split("-");
  const year = Number(yStr);
  if (bucket === "year") return { from: `${yStr}-01-01`, to: `${yStr}-12-31` };
  const month = Number(mStr);
  const last = lastDayOfMonth(year, month);
  return { from: iso, to: `${yStr}-${mStr}-${String(last).padStart(2, "0")}` };
}

/** Resolve a period preset (วันนี้/เดือนนี้/ปีนี้/custom) against today's
 * Bangkok date. An invalid/missing custom range falls back to month-to-date
 * (the accounting register's default). */
export function resolvePeriod(
  preset: PeriodPreset,
  todayIso: string,
  customFrom?: string,
  customTo?: string,
): ReportPeriod {
  if (preset === "custom") {
    if (
      customFrom &&
      customTo &&
      ISO_DATE_REGEX.test(customFrom) &&
      ISO_DATE_REGEX.test(customTo) &&
      customFrom <= customTo
    ) {
      return { from: customFrom, to: customTo };
    }
    // fall through to month-to-date
  } else if (preset === "today") {
    return { from: todayIso, to: todayIso };
  } else if (preset === "year") {
    return { from: `${todayIso.slice(0, 4)}-01-01`, to: todayIso };
  }
  return { from: `${todayIso.slice(0, 7)}-01`, to: todayIso };
}

/** Spec 262 U1: the by-purchaser slice is staff-performance data, gated to
 * the manager tier ∪ procurement_manager (RAISE 42501 for plain procurement
 * AND accounting). Defense-in-depth mirror of the RPC's own check — the RPC
 * refuses regardless, but the UI should never render a control it can't use. */
export function resolveGroupBy(requested: ReportGroupBy, canSeePurchaser: boolean): ReportGroupBy {
  return requested === "purchaser" && !canSeePurchaser ? "none" : requested;
}

const BASE_GROUP_BY_OPTIONS: ReportGroupBy[] = ["none", "project", "supplier", "category"];

export function availableGroupByOptions(canSeePurchaser: boolean): ReportGroupBy[] {
  return canSeePurchaser ? [...BASE_GROUP_BY_OPTIONS, "purchaser"] : BASE_GROUP_BY_OPTIONS;
}

/** The RPC's raw row shape (snake_case, as returned by supabase-js .rpc()). */
export interface PurchaseReportRawRow {
  bucket: string;
  group_key: string;
  group_label: string;
  line_gross: number;
  charge_gross: number;
  gross: number;
  net: number;
  vat: number;
  pr_count: number;
}

export interface PurchaseReportRow {
  bucket: string;
  bucketLabel: string;
  groupKey: string;
  groupLabel: string;
  lineGross: number;
  chargeGross: number;
  gross: number;
  net: number;
  vat: number;
  prCount: number;
}

export function mapReportRow(bucket: ReportBucket, raw: PurchaseReportRawRow): PurchaseReportRow {
  return {
    bucket: raw.bucket,
    bucketLabel: bucketLabel(bucket, raw.bucket),
    groupKey: raw.group_key,
    groupLabel: raw.group_label,
    lineGross: raw.line_gross,
    chargeGross: raw.charge_gross,
    gross: raw.gross,
    net: raw.net,
    vat: raw.vat,
    prCount: raw.pr_count,
  };
}

export interface ReportTotals {
  gross: number;
  net: number;
  vat: number;
  chargeGross: number;
  count: number;
}

/** Satang-safe sum across report rows — the same round-at-the-line-then-sum
 * discipline as summarizePurchases, so this surface can never disagree with
 * the accounting register for the same underlying purchases. */
export function summarizeReportRows(
  rows: ReadonlyArray<Pick<PurchaseReportRow, "gross" | "net" | "vat" | "chargeGross" | "prCount">>,
): ReportTotals {
  let grossSatang = 0;
  let netSatang = 0;
  let vatSatang = 0;
  let chargeSatang = 0;
  let count = 0;
  for (const r of rows) {
    grossSatang += Math.round(r.gross * 100);
    netSatang += Math.round(r.net * 100);
    vatSatang += Math.round(r.vat * 100);
    chargeSatang += Math.round(r.chargeGross * 100);
    count += r.prCount;
  }
  return {
    gross: grossSatang / 100,
    net: netSatang / 100,
    vat: vatSatang / 100,
    chargeGross: chargeSatang / 100,
    count,
  };
}

export interface TrendPoint {
  bucket: string;
  bucketLabel: string;
  gross: number;
}

/** The trend chart is always over TIME, independent of the table's chosen
 * group-by — sums gross across every group within a bucket. */
export function trendByBucket(rows: ReadonlyArray<PurchaseReportRow>): TrendPoint[] {
  const bySatang = new Map<string, { label: string; satang: number }>();
  for (const r of rows) {
    const existing = bySatang.get(r.bucket);
    const satang = Math.round(r.gross * 100);
    if (existing) existing.satang += satang;
    else bySatang.set(r.bucket, { label: r.bucketLabel, satang });
  }
  return [...bySatang.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, bucketLabel: v.label, gross: v.satang / 100 }));
}

/** Hand-rolled bar width — % of the series max, clamped 0..100 (the SpendBar
 * family; no charting dependency). */
export function barPct(amount: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((amount / max) * 100)));
}

export interface ReportQueryState {
  preset: PeriodPreset;
  from: string;
  to: string;
  bucket: ReportBucket;
  group: ReportGroupBy;
  projectId?: string;
}

/** The page's + export route's shared raw query shape — both call
 * parseReportQuery with the exact same signature, so their resolved state
 * can never drift (the payroll page/route gate-drift anti-pattern, applied
 * to param parsing rather than the role gate). */
export type ReportRawQuery = Partial<
  Record<"preset" | "from" | "to" | "bucket" | "group" | "project", string | undefined>
>;

function isBucketValue(v: string | undefined): v is ReportBucket {
  return v === "day" || v === "month" || v === "year";
}

function isGroupByValue(v: string | undefined): v is ReportGroupBy {
  return (
    v === "project" || v === "supplier" || v === "category" || v === "purchaser" || v === "none"
  );
}

function isPresetValue(v: string | undefined): v is PeriodPreset {
  return v === "today" || v === "month" || v === "year" || v === "custom";
}

/** Parse + resolve the page/route's raw searchParams into the report's
 * query state — ONE function both the page and the export route call, so
 * defaults and the purchaser-slice narrowing can never disagree between them. */
export function parseReportQuery(
  sp: ReportRawQuery,
  todayIso: string,
  canSeePurchaser: boolean,
): ReportQueryState {
  const preset: PeriodPreset = isPresetValue(sp.preset) ? sp.preset : "month";
  const bucket: ReportBucket = isBucketValue(sp.bucket) ? sp.bucket : "day";
  const group = resolveGroupBy(isGroupByValue(sp.group) ? sp.group : "none", canSeePurchaser);
  const { from, to } = resolvePeriod(preset, todayIso, sp.from, sp.to);
  return {
    preset,
    bucket,
    group,
    from,
    to,
    ...(sp.project ? { projectId: sp.project } : {}),
  };
}

/** Deep-linkable query string for /requests/reports (or its /export sibling)
 * — the full current state plus an override, so a facet chip never drops
 * the others (the /projects filter-bar pattern). */
export function reportHref(
  state: ReportQueryState,
  overrides: Partial<ReportQueryState> = {},
  base = "/requests/reports",
): string {
  const merged = { ...state, ...overrides };
  const q = new URLSearchParams({
    preset: merged.preset,
    from: merged.from,
    to: merged.to,
    bucket: merged.bucket,
    group: merged.group,
  });
  if (merged.projectId) q.set("project", merged.projectId);
  return `${base}?${q.toString()}`;
}

export interface RegisterDrillParams {
  from: string;
  to: string;
  dim?: Exclude<ReportGroupBy, "none">;
  key?: string;
  unassigned?: boolean;
}

/** A bucket×group table row → the register-style list filtered to that
 * slice. No dim = the 'none' group (date window only). */
export function registerDrillHref(params: RegisterDrillParams): string {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.dim) {
    q.set("dim", params.dim);
    if (params.unassigned) q.set("unassigned", "1");
    else if (params.key !== undefined) q.set("key", params.key);
  }
  return `/requests/reports/register?${q.toString()}`;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const REPORT_CSV_HEADER = [
  "ช่วงเวลา",
  "กลุ่ม",
  "ยอดตามรายการ",
  "ค่าใช้จ่ายเพิ่มเติม",
  "ยอดรวม",
  "มูลค่าก่อนภาษี",
  "ภาษีมูลค่าเพิ่ม",
  "จำนวนใบขอซื้อ",
];

/** CSV export — Thai headers (labels.ts terms), UTF-8 BOM so Excel opens Thai
 * clean (the payroll export's precedent, spec 69). */
export function reportRowsToCsv(rows: ReadonlyArray<PurchaseReportRow>): string {
  const lines: string[] = [REPORT_CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.bucketLabel),
        csvCell(r.groupLabel),
        r.lineGross.toFixed(2),
        r.chargeGross.toFixed(2),
        r.gross.toFixed(2),
        r.net.toFixed(2),
        r.vat.toFixed(2),
        String(r.prCount),
      ].join(","),
    );
  }
  return "﻿" + lines.join("\n") + "\n";
}
