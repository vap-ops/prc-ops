"use client";

// Spec 363 U2b — the ประวัติ tab's renderer.
//
// 'use client' justification: the filter chips hold local state. Everything else
// (the query, the merge, the day grouping, the burst collapsing) happens on the
// server via buildWpTimeline, so this file is presentation only.
//
// The decision row renders its COMMENT inline. That line — "รูปที่ 3–5 เป็นห้องอื่น"
// — is the single most useful thing on the tab for a site admin, and before this
// unit it sat inside a collapsed <details> in the ข้อมูล tab. It is the reason
// ประวัติ earns a tab rather than folding into the ⓘ sheet.

import { useState } from "react";
import {
  Camera,
  ClipboardCheck,
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  RotateCcw,
} from "lucide-react";
import type {
  WpTimelineDay,
  WpTimelineFilter,
  WpTimelineRow,
} from "@/lib/work-packages/wp-timeline";
import { timelineFilterOf } from "@/lib/work-packages/wp-timeline";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_REVISION_REASON_LABEL,
  PHOTO_PHASE_LABEL,
  formatThaiDate,
  formatThaiTime,
} from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";

const CHIPS: { key: WpTimelineFilter | "all"; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "photos", label: "รูป" },
  { key: "review", label: "ตรวจ" },
  { key: "materials", label: "ของ" },
  { key: "status", label: "สถานะ" },
];

// The two audit events a site_admin may actually read (spec 363 §4.1).
const REWORK_EVENT_LABEL: Record<string, string> = {
  wp_reopened_for_defect: "เปิดงานแก้ไข",
  wp_evidence_resubmitted: "ส่งตรวจอีกครั้ง",
};

function RowIcon({ kind }: { kind: WpTimelineRow["kind"] }) {
  const cls = "size-4 shrink-0 text-ink-secondary";
  switch (kind) {
    case "photos":
      return <Camera aria-hidden className={cls} />;
    case "decision":
      return <ClipboardCheck aria-hidden className={cls} />;
    case "request":
      return <ShoppingCart aria-hidden className={cls} />;
    case "issue":
      return <PackageMinus aria-hidden className={cls} />;
    case "return":
      return <PackagePlus aria-hidden className={cls} />;
    default:
      return <RotateCcw aria-hidden className={cls} />;
  }
}

function RowBody({ row }: { row: WpTimelineRow }) {
  switch (row.kind) {
    case "photos":
      return (
        <>
          <p className="text-body text-ink">
            ถ่ายรูป {PHOTO_PHASE_LABEL[row.phase as keyof typeof PHOTO_PHASE_LABEL] ?? row.phase} ·{" "}
            {row.count} รูป
          </p>
          <p className="text-meta text-ink-secondary">
            {row.actor ? `${row.actor} · ` : ""}
            {/* Compare the FORMATTED values: two captures 40s apart are different
                stamps but the same displayed minute, and "19:12–19:12" reads as a
                bug to the person holding the phone. */}
            {formatThaiTime(row.at)}
            {formatThaiTime(row.until) !== formatThaiTime(row.at)
              ? `–${formatThaiTime(row.until)}`
              : ""}
          </p>
        </>
      );
    case "decision":
      return (
        <>
          <p className="text-body text-ink">
            {row.reason
              ? (APPROVAL_REVISION_REASON_LABEL[
                  row.reason as keyof typeof APPROVAL_REVISION_REASON_LABEL
                ] ?? row.reason)
              : (APPROVAL_DECISION_LABEL[row.decision as keyof typeof APPROVAL_DECISION_LABEL] ??
                row.decision)}
          </p>
          {row.comment ? (
            <p className="text-body text-ink-secondary mt-1 whitespace-pre-wrap">{row.comment}</p>
          ) : null}
          <p className="text-meta text-ink-secondary">
            {row.actor ? `${row.actor} · ` : ""}
            {formatThaiTime(row.at)}
          </p>
        </>
      );
    case "request":
      return (
        <>
          <p className="text-body text-ink">
            ขอซื้อ {row.prNumber} · {row.item} {row.qty} {row.unit}
          </p>
          <p className="text-meta text-ink-secondary">
            {row.actor ? `${row.actor} · ` : ""}
            {formatThaiTime(row.at)}
          </p>
        </>
      );
    case "issue":
    case "return":
      return (
        <>
          <p className="text-body text-ink">
            {row.kind === "issue" ? "เบิกของ" : "คืนของ"} · {row.item} {row.qty} {row.unit}
          </p>
          <p className="text-meta text-ink-secondary">
            {row.actor ? `${row.actor} · ` : ""}
            {formatThaiTime(row.at)}
          </p>
        </>
      );
    case "rework":
      return (
        <>
          <p className="text-body text-ink">{REWORK_EVENT_LABEL[row.event] ?? row.event}</p>
          <p className="text-meta text-ink-secondary">
            {row.actor ? `${row.actor} · ` : ""}
            {formatThaiTime(row.at)}
          </p>
        </>
      );
    default:
      return null;
  }
}

export function WpTimelineView({ days }: { days: WpTimelineDay[] }) {
  const [filter, setFilter] = useState<WpTimelineFilter | "all">("all");

  const shown = days
    .map((d) => ({
      ...d,
      rows: d.rows.filter((r) => filter === "all" || timelineFilterOf(r.kind) === filter),
    }))
    .filter((d) => d.rows.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="กรองประวัติ"
        className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto pb-1"
      >
        {CHIPS.map((c) => {
          const active = c.key === filter;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(c.key)}
              // Selected state copies the house pattern (bank-select): the
              // action-soft ground with an action border. NOT bg-action —
              // globals.css reserves --color-action for "links + active-nav ONLY".
              className={`rounded-control focus-visible:ring-action min-h-11 shrink-0 border px-3 text-sm font-semibold whitespace-nowrap focus:outline-none focus-visible:ring-2 ${
                active
                  ? "border-action bg-action-soft text-action"
                  : "border-edge bg-card text-ink-secondary"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className={`${CARD} text-body text-ink-secondary`}>ยังไม่มีประวัติ</p>
      ) : (
        shown.map((day) => (
          <section key={day.date} className="flex flex-col gap-2">
            <p className="text-meta text-ink-secondary">{formatThaiDate(day.date)}</p>
            <ul className="border-edge flex flex-col gap-3 border-l-2 pl-3">
              {day.rows.map((row) => (
                <li key={row.key} className="flex gap-2.5">
                  <span className="mt-0.5">
                    <RowIcon kind={row.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <RowBody row={row} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
