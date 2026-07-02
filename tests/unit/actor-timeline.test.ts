// Spec 244 U5 — pure helpers behind /settings/usage/[actorId] (the per-person
// activity timeline). The RPC (get_actor_timeline) returns per-session rows with
// jsonb screens/friction; these helpers parse the untyped jsonb, group sessions
// into display days (Asia/Bangkok), and collapse the screen sequence. No DB /
// Date.now access — rows and timestamps come in as data, so everything is
// deterministic under test.

import { describe, expect, it } from "vitest";
import {
  dedupeScreens,
  groupTimelineByDay,
  parseTimelineRows,
  type TimelineSession,
} from "@/lib/usage/actor-timeline";

function session(partial: Partial<TimelineSession>): TimelineSession {
  return {
    sessionId: "s",
    startedAt: "2026-07-01T03:00:00.000Z",
    lastSeenAt: "2026-07-01T03:05:00.000Z",
    durationMs: 60_000,
    screens: [],
    friction: [],
    ...partial,
  };
}

describe("parseTimelineRows", () => {
  it("maps RPC rows and keeps well-formed screen/friction entries", () => {
    const rows = parseTimelineRows([
      {
        session_id: "a",
        started_at: "2026-07-01T03:00:00+00:00",
        last_seen_at: "2026-07-01T03:10:00+00:00",
        duration_ms: 40_000,
        screens: [{ route: "/sa/photos", at: "2026-07-01T03:01:00+00:00" }],
        friction: [{ type: "js_error", route: "/sa/photos", at: "2026-07-01T03:02:00+00:00" }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe("a");
    expect(rows[0]!.durationMs).toBe(40_000);
    expect(rows[0]!.screens).toEqual([{ route: "/sa/photos", at: "2026-07-01T03:01:00+00:00" }]);
    expect(rows[0]!.friction).toEqual([
      { type: "js_error", route: "/sa/photos", at: "2026-07-01T03:02:00+00:00" },
    ]);
  });

  it("drops malformed jsonb entries instead of throwing", () => {
    const rows = parseTimelineRows([
      {
        session_id: "a",
        started_at: "2026-07-01T03:00:00+00:00",
        last_seen_at: "2026-07-01T03:10:00+00:00",
        duration_ms: 0,
        screens: [42, { nope: true }, { route: "/sa", at: "2026-07-01T03:01:00+00:00" }],
        friction: "not-an-array",
      },
    ]);
    expect(rows[0]!.screens).toEqual([{ route: "/sa", at: "2026-07-01T03:01:00+00:00" }]);
    expect(rows[0]!.friction).toEqual([]);
  });
});

describe("dedupeScreens", () => {
  it("normalizes id segments and collapses CONSECUTIVE duplicates with a count", () => {
    const visits = dedupeScreens([
      { route: "/projects/9f8b6c1e-0000-4000-8000-000000000001/wp/12", at: "t1" },
      { route: "/projects/1a2b3c4d-0000-4000-8000-000000000002/wp/99", at: "t2" },
      { route: "/sa", at: "t3" },
    ]);
    expect(visits).toEqual([
      { route: "/projects/:id/wp/:id", count: 2 },
      { route: "/sa", count: 1 },
    ]);
  });

  it("keeps NON-consecutive repeats as separate visits (the back-and-forth is the story)", () => {
    const visits = dedupeScreens([
      { route: "/sa", at: "t1" },
      { route: "/sa/photos", at: "t2" },
      { route: "/sa", at: "t3" },
    ]);
    expect(visits).toEqual([
      { route: "/sa", count: 1 },
      { route: "/sa/photos", count: 1 },
      { route: "/sa", count: 1 },
    ]);
  });

  it("treats a null route as the root", () => {
    expect(dedupeScreens([{ route: null, at: "t1" }])).toEqual([{ route: "/", count: 1 }]);
  });
});

describe("groupTimelineByDay", () => {
  it("buckets a late-UTC session into the NEXT Bangkok day (UTC+7 boundary)", () => {
    // 22:30Z on 1 Jul = 05:30 on 2 Jul in Asia/Bangkok.
    const days = groupTimelineByDay([session({ startedAt: "2026-07-01T22:30:00.000Z" })]);
    expect(days).toHaveLength(1);
    expect(days[0]!.day).toBe("2026-07-02");
  });

  it("orders days newest-first and sessions newest-first within a day, summing duration", () => {
    const days = groupTimelineByDay([
      session({ sessionId: "old", startedAt: "2026-06-30T02:00:00.000Z", durationMs: 10_000 }),
      session({ sessionId: "am", startedAt: "2026-07-01T01:00:00.000Z", durationMs: 20_000 }),
      session({ sessionId: "pm", startedAt: "2026-07-01T08:00:00.000Z", durationMs: 40_000 }),
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-07-01", "2026-06-30"]);
    expect(days[0]!.sessions.map((s) => s.sessionId)).toEqual(["pm", "am"]);
    expect(days[0]!.totalDurationMs).toBe(60_000);
    expect(days[1]!.totalDurationMs).toBe(10_000);
  });
});
