// Spec 138 U3 — the scrollable status-chip filter with live counts. Pure: turns the
// supplier/project-narrowed rows + the current filter into the four band-level chip
// descriptors the pill row renders (ทั้งหมด / อนุมัติแล้ว=to_order / กำลังจัดส่ง=in_transit /
// เกินกำหนด=overdue). Counts reuse the spec-105 procurementSummary so they agree with the KPI
// hero (U2), and are LIVE to the supplier/project axes (the caller passes the narrowed rows).
// The chips drive the band axis added to ProcurementFilter (worklist-filter.ts); the raw
// `status` axis stays an URL-only escape and is preserved across chip clicks.

import {
  PROCUREMENT_BAND_LABEL,
  procurementBand,
  procurementSummary,
} from "./procurement-pipeline";
import { buildWorklistQuery, type ProcurementFilter } from "./worklist-filter";

export type WorklistStatusChipKey = "all" | "to_order" | "in_transit" | "overdue";

export interface WorklistStatusChip {
  key: WorklistStatusChipKey;
  label: string;
  count: number;
  href: string;
  active: boolean;
}

export function buildWorklistStatusChips(input: {
  /** Rows already narrowed by supplier/project — counts are live to those axes. */
  rows: ReadonlyArray<{ status: string; eta: string | null }>;
  /** The current filter (supplier/project/status preserved across chip clicks). */
  filter: ProcurementFilter;
  /** Bangkok civil date "YYYY-MM-DD". */
  todayIso: string;
}): WorklistStatusChip[] {
  const { rows, filter, todayIso } = input;
  const summary = procurementSummary(rows, todayIso);
  // "all" = the whole pipeline (rows with a band); rejected/cancelled (no band) are excluded —
  // they never render in the pipeline and have their own URL-only status escape.
  const all = rows.reduce((n, r) => (procurementBand(r.status) !== null ? n + 1 : n), 0);

  return [
    {
      key: "all",
      label: PROCUREMENT_BAND_LABEL.all,
      count: all,
      href: buildWorklistQuery({ ...filter, band: null, overdue: false }),
      active: !filter.overdue && filter.band === null,
    },
    {
      key: "to_order",
      label: PROCUREMENT_BAND_LABEL.to_order,
      count: summary.toOrder,
      href: buildWorklistQuery({ ...filter, band: "to_order", overdue: false }),
      active: !filter.overdue && filter.band === "to_order",
    },
    {
      key: "in_transit",
      label: PROCUREMENT_BAND_LABEL.in_transit,
      count: summary.inTransit,
      href: buildWorklistQuery({ ...filter, band: "in_transit", overdue: false }),
      active: !filter.overdue && filter.band === "in_transit",
    },
    {
      key: "overdue",
      label: PROCUREMENT_BAND_LABEL.overdue,
      count: summary.overdue,
      href: buildWorklistQuery({ ...filter, band: null, overdue: true }),
      active: filter.overdue,
    },
  ];
}
