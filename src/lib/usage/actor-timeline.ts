// Spec 244 U5 / ADR 0068 (Tier B) — pure helpers behind /settings/usage/[actorId],
// the per-person activity timeline. The get_actor_timeline RPC (mig 20260813057000)
// already groups the heartbeat-dominated raw slice into per-session rows; these
// helpers parse the untyped jsonb columns, bucket sessions into display days
// (Asia/Bangkok — the operator reads Thai wall-clock time), and collapse the screen
// sequence for a readable "what did they do" story. No DB / Date.now access — rows
// and timestamps come in as data, so the shaping logic is unit-testable.
//
// Framing note (ADR 0068 §5): this is a SUPPORT read ("see what happened so you can
// help"), never a scoreboard — the page renders it with protective copy.

import { normalizeRoute } from "@/lib/usage/friction-map";

const DISPLAY_TZ = "Asia/Bangkok";

export interface TimelineScreenView {
  route: string | null;
  at: string;
}

export interface TimelineFrictionEvent {
  type: string;
  route: string | null;
  at: string;
}

export interface TimelineSession {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  durationMs: number;
  screens: TimelineScreenView[];
  friction: TimelineFrictionEvent[];
}

export interface ScreenVisit {
  route: string; // normalized
  count: number;
}

export interface TimelineDay {
  day: string; // 'YYYY-MM-DD' in the display timezone
  totalDurationMs: number;
  sessions: TimelineSession[];
}

interface RpcTimelineRow {
  session_id: string;
  started_at: string;
  last_seen_at: string;
  duration_ms: number;
  screens: unknown;
  friction: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function routeOf(v: Record<string, unknown>): string | null | undefined {
  const route = v["route"];
  return typeof route === "string" || route === null ? route : undefined;
}

// The jsonb arrays cross an untyped boundary (Postgres -> generated Json type), so
// narrow entry-by-entry and DROP malformed entries rather than throwing — a bad
// event must never take the whole timeline down.
function asScreens(v: unknown): TimelineScreenView[] {
  if (!Array.isArray(v)) return [];
  const out: TimelineScreenView[] = [];
  for (const e of v) {
    if (!isRecord(e)) continue;
    const route = routeOf(e);
    const at = e["at"];
    if (route !== undefined && typeof at === "string") out.push({ route, at });
  }
  return out;
}

function asFriction(v: unknown): TimelineFrictionEvent[] {
  if (!Array.isArray(v)) return [];
  const out: TimelineFrictionEvent[] = [];
  for (const e of v) {
    if (!isRecord(e)) continue;
    const route = routeOf(e);
    const at = e["at"];
    const type = e["type"];
    if (route !== undefined && typeof at === "string" && typeof type === "string") {
      out.push({ type, route, at });
    }
  }
  return out;
}

export function parseTimelineRows(rows: ReadonlyArray<RpcTimelineRow>): TimelineSession[] {
  return rows.map((r) => ({
    sessionId: r.session_id,
    startedAt: r.started_at,
    lastSeenAt: r.last_seen_at,
    durationMs: r.duration_ms,
    screens: asScreens(r.screens),
    friction: asFriction(r.friction),
  }));
}

// Collapse the visit sequence for display: normalize id segments (same rule as the
// friction map, so screens read consistently across the two surfaces) and merge
// CONSECUTIVE repeats into one visit with a count. Non-consecutive repeats stay
// separate — going back to a screen is part of the story.
export function dedupeScreens(screens: ReadonlyArray<TimelineScreenView>): ScreenVisit[] {
  const out: ScreenVisit[] = [];
  for (const s of screens) {
    const route = normalizeRoute(s.route);
    const last = out[out.length - 1];
    if (last && last.route === route) last.count += 1;
    else out.push({ route, count: 1 });
  }
  return out;
}

// Bucket sessions into display days by their START time in the display timezone
// (UTC+7 — a 22:30Z session belongs to the NEXT Thai day). Days newest-first,
// sessions newest-first within a day, with a per-day duration total.
export function groupTimelineByDay(
  sessions: ReadonlyArray<TimelineSession>,
  timeZone: string = DISPLAY_TZ,
): TimelineDay[] {
  // en-CA renders YYYY-MM-DD, a sortable day key.
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byDay = new Map<string, TimelineDay>();
  for (const s of sorted) {
    const day = dayFmt.format(new Date(s.startedAt));
    let acc = byDay.get(day);
    if (!acc) {
      acc = { day, totalDurationMs: 0, sessions: [] };
      byDay.set(day, acc);
    }
    acc.totalDurationMs += s.durationMs;
    acc.sessions.push(s);
  }
  // Insertion order already follows the newest-first session sort.
  return [...byDay.values()];
}
// Time-of-day display reuses formatThaiTime (labels.ts) — no formatter here.
