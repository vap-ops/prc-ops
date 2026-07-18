// Spec 327 U4 — the procurement timeline projection (pure). Near-full reuse of
// the spec-92 gantt-scale math: WP bars via barFor over planned windows, PR
// pins via barFor with a same-start/end window (the spec-255 activityGeom
// precedent — a pin is a 1-day bar whose x we take). ScheduleGantt itself is
// NOT a drop-in (deliverable/dependency props, desktop DNA) — this model feeds
// a thin mobile-first renderer instead.
//
// Placement rules (§0.1 — nothing dropped):
// - dated WP → a lane (flat, code order; groups included — their planned span
//   is a real summary bar, and per the U2 lesson PRs can anchor a group).
// - active PR with eta → a pin on its ADR-0065 anchor WP's lane; anchorless or
//   foreign-anchor → the คลัง lane on top.
// - undated WP → the ยังไม่กำหนดวันที่ shelf; active no-eta PR → the
//   ไม่ทราบวันถึง shelf. done/closed PRs appear nowhere (history, not supply).
// - pin etas join the domain so a far-future delivery still lands on-axis.

import {
  barFor,
  buildTimeline,
  type ScheduleBar,
  type SchedulePeriod,
  type Timeline,
} from "@/lib/work-packages/gantt-scale";
import { anchorWorkPackageId, selectLateRisk } from "./late-risk";
import { ACTIVE_REQUEST_BANDS, requestBand } from "./request-bands";
import type { TimePrRow } from "./time-view";

export interface TimelineWpInput {
  id: string;
  code: string;
  name: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  isGroup: boolean;
}

export interface TimelinePin {
  id: string;
  prNumber: number;
  itemDescription: string;
  eta: string;
  x: number;
  /** เสี่ยงช้า per the U1 SSOT (eta after the anchor WP's planned start). */
  late: boolean;
}

export interface TimelineLane {
  wp: TimelineWpInput;
  bar: ScheduleBar | null;
  pins: TimelinePin[];
}

export interface ProcurementTimelineModel {
  timeline: Timeline;
  /** Anchorless / foreign-anchor pins — the คลัง lane above the WP lanes. */
  storeLane: TimelinePin[];
  lanes: TimelineLane[];
  undatedWps: TimelineWpInput[];
  noEtaPrs: TimePrRow[];
}

const OPEN_BANDS = new Set<string>(ACTIVE_REQUEST_BANDS);

export function buildProcurementTimeline(
  wps: ReadonlyArray<TimelineWpInput>,
  prRows: ReadonlyArray<TimePrRow>,
  period: SchedulePeriod,
  todayIso: string,
): ProcurementTimelineModel {
  const active = prRows.filter((r) => OPEN_BANDS.has(requestBand(r.status)));
  const withEta = active.filter((r): r is TimePrRow & { eta: string } => r.eta !== null);
  const noEtaPrs = active.filter((r) => r.eta === null);

  const dated = wps.filter((w) => w.plannedStart !== null && w.plannedEnd !== null);
  const undatedWps = wps.filter((w) => w.plannedStart === null || w.plannedEnd === null);

  // Domain = WP windows + every pin's eta (a delivery beyond all windows must
  // still land on-axis, not off the right edge).
  const timeline = buildTimeline(
    [
      ...dated.map((w) => ({ plannedStart: w.plannedStart, plannedEnd: w.plannedEnd })),
      ...withEta.map((r) => ({ plannedStart: r.eta, plannedEnd: r.eta })),
    ],
    period,
    todayIso,
  );

  const lateIds = new Set(
    selectLateRisk(withEta, new Map(wps.map((w) => [w.id, { plannedStart: w.plannedStart }]))).map(
      (r) => r.id,
    ),
  );

  const laneByWp = new Map<string, TimelineLane>(
    dated.map((w) => [
      w.id,
      { wp: w, bar: barFor(w, timeline.domainStartMs, timeline.dayWidth), pins: [] },
    ]),
  );
  const storeLane: TimelinePin[] = [];

  for (const r of withEta) {
    const geom = barFor(
      { plannedStart: r.eta, plannedEnd: r.eta },
      timeline.domainStartMs,
      timeline.dayWidth,
    );
    if (!geom) continue; // unreachable: eta joined the domain above
    const pin: TimelinePin = {
      id: r.id,
      prNumber: r.prNumber,
      itemDescription: r.itemDescription,
      eta: r.eta,
      x: geom.x,
      late: lateIds.has(r.id),
    };
    const anchorId = anchorWorkPackageId(r);
    const lane = anchorId !== null ? laneByWp.get(anchorId) : undefined;
    if (lane) lane.pins.push(pin);
    else storeLane.push(pin);
  }

  const byX = (a: TimelinePin, b: TimelinePin) => a.x - b.x;
  storeLane.sort(byX);
  const lanes = [...laneByWp.values()];
  for (const lane of lanes) lane.pins.sort(byX);

  return { timeline, storeLane, lanes, undatedWps, noEtaPrs };
}
