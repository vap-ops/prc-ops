// Spec 138 U2/U4 — the desktop KPI hero row. Pure: packages the spec-105 procurement
// summary into the four tile descriptors the row renders (รอสั่งซื้อ · กำลังจัดส่ง ·
// เกินกำหนด · ค้างจ่าย), deriving each tile's filter href/active from the current filter.
// U4: the รอสั่งซื้อ / กำลังจัดส่ง tiles tap-to-filter their band (reusing the U3 band axis);
// the เกินกำหนด tile keeps its chase toggle; ค้างจ่าย stays static. Toggle logic mirrors the
// U3 buildWorklistStatusChips so href/active live in one place. The /requests page renders
// from it for procurement only.

import {
  PROCUREMENT_BAND_LABEL,
  type ProcurementSummary,
} from "@/lib/purchasing/procurement-pipeline";
import { buildWorklistQuery, type ProcurementFilter } from "@/lib/purchasing/worklist-filter";

export type WorklistKpiTone = "hot" | "shipping" | "danger" | "neutral";
export type WorklistKpiIcon = "waiting" | "shipping" | "overdue" | "outstanding" | "delivered";

export interface WorklistKpiTile {
  key: "to_order" | "in_transit" | "overdue" | "outstanding" | "delivered";
  label: string;
  value: string;
  caption: string;
  tone: WorklistKpiTone;
  icon: WorklistKpiIcon;
  /** The tile's filter target; null for the static ค้างจ่าย tile. */
  href: string | null;
  /** The tile's pressed state (its filter is the current selection); false otherwise. */
  active: boolean;
}

export function buildWorklistKpis(input: {
  summary: ProcurementSummary;
  /** Preformatted ฿ string (money — read back-office by the page). */
  outstanding: string;
  /** Preformatted ฿ string — cumulative value of delivered purchases. When
   *  supplied, appends the ส่งมอบแล้ว tile so the spend stays visible once every
   *  request has reached delivered (the active-work tiles all read 0 then). The
   *  page always supplies it for procurement; omitted = no tile (back-compat). */
  deliveredSpend?: string;
  /** The current worklist filter — drives every tile's href/active. */
  filter: ProcurementFilter;
}): WorklistKpiTile[] {
  const { summary, outstanding, deliveredSpend, filter } = input;
  // U4 band toggle: set this band (clearing overdue), or clear it if already the selection —
  // mirrors the U3 status chips. A band tile reads active only when overdue is off.
  const bandTile = (band: "to_order" | "in_transit") => ({
    href: buildWorklistQuery({
      ...filter,
      band: filter.band === band ? null : band,
      overdue: false,
    }),
    active: !filter.overdue && filter.band === band,
  });
  return [
    {
      key: "to_order",
      label: PROCUREMENT_BAND_LABEL.to_order,
      value: String(summary.toOrder),
      caption: "พร้อมออกใบสั่งซื้อ",
      tone: "hot",
      icon: "waiting",
      ...bandTile("to_order"),
    },
    {
      key: "in_transit",
      label: PROCUREMENT_BAND_LABEL.in_transit,
      value: String(summary.inTransit),
      caption: "ระหว่างขนส่ง",
      tone: "shipping",
      icon: "shipping",
      ...bandTile("in_transit"),
    },
    {
      key: "overdue",
      label: PROCUREMENT_BAND_LABEL.overdue,
      value: String(summary.overdue),
      caption: "ติดตามด่วน",
      // Danger when there's something to chase OR the chase filter is on; calm otherwise.
      tone: summary.overdue > 0 || filter.overdue ? "danger" : "neutral",
      icon: "overdue",
      // Unchanged spec-110 chase toggle (preserves the band axis, unlike the band tiles).
      href: buildWorklistQuery({ ...filter, overdue: !filter.overdue }),
      active: filter.overdue,
    },
    {
      key: "outstanding",
      label: "ค้างจ่าย",
      value: outstanding,
      caption: "ยังไม่ชำระ",
      tone: "neutral",
      icon: "outstanding",
      href: null,
      active: false,
    },
    // ส่งมอบแล้ว — cumulative delivered spend. Appended only when supplied so the
    // money stays visible after every PR reaches delivered (active tiles → 0).
    ...(deliveredSpend !== undefined
      ? [
          {
            key: "delivered" as const,
            label: "ส่งมอบแล้ว",
            value: deliveredSpend,
            caption: "ยอดซื้อที่รับของแล้ว",
            tone: "neutral" as const,
            icon: "delivered" as const,
            href: null,
            active: false,
          },
        ]
      : []),
  ];
}
