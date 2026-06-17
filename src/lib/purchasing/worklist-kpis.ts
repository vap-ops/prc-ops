// Spec 138 U2 — the desktop KPI hero row. Pure: packages the spec-105 procurement
// summary into the four tile descriptors the row renders (รอสั่งซื้อ · กำลังจัดส่ง ·
// เกินกำหนด · ค้างจ่าย), deriving the เกินกำหนด tile's chase-toggle state. The
// /requests page renders from it for procurement only.

import type { ProcurementSummary } from "@/lib/purchasing/procurement-pipeline";

export type WorklistKpiTone = "hot" | "shipping" | "danger" | "neutral";
export type WorklistKpiIcon = "waiting" | "shipping" | "overdue" | "outstanding";

export interface WorklistKpiTile {
  key: "to_order" | "in_transit" | "overdue" | "outstanding";
  label: string;
  value: string;
  caption: string;
  tone: WorklistKpiTone;
  icon: WorklistKpiIcon;
  /** The เกินกำหนด chase-filter target; null for the static tiles. */
  href: string | null;
  /** The เกินกำหนด tile's pressed state (filter active); false otherwise. */
  active: boolean;
}

export function buildWorklistKpis(input: {
  summary: ProcurementSummary;
  /** Preformatted ฿ string (money — read back-office by the page). */
  outstanding: string;
  /** buildWorklistQuery({ ...filter, overdue: !filter.overdue }) — the chase toggle. */
  overdueHref: string;
  /** filter.overdue — the chase filter is on. */
  overdueActive: boolean;
}): WorklistKpiTile[] {
  const { summary, outstanding, overdueHref, overdueActive } = input;
  return [
    {
      key: "to_order",
      label: "รอสั่งซื้อ",
      value: String(summary.toOrder),
      caption: "พร้อมออกใบสั่งซื้อ",
      tone: "hot",
      icon: "waiting",
      href: null,
      active: false,
    },
    {
      key: "in_transit",
      label: "กำลังจัดส่ง",
      value: String(summary.inTransit),
      caption: "ระหว่างขนส่ง",
      tone: "shipping",
      icon: "shipping",
      href: null,
      active: false,
    },
    {
      key: "overdue",
      label: "เกินกำหนด",
      value: String(summary.overdue),
      caption: "ติดตามด่วน",
      // Danger when there's something to chase OR the chase filter is on; calm otherwise.
      tone: summary.overdue > 0 || overdueActive ? "danger" : "neutral",
      icon: "overdue",
      href: overdueHref,
      active: overdueActive,
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
  ];
}
