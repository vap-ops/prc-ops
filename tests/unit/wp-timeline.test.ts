// Writing failing test first.
//
// Spec 363 U2b — the ประวัติ timeline. This pins the PURE builder: raw rows in,
// day-grouped display rows out. The tab's markup is a Server Component the suite
// cannot render, so every rule that could be wrong — day boundaries, burst
// collapsing, ordering, filter grouping — lives here where it can be tested.
//
// Photo bursts collapse because SAs wrote 2031 photos in 30 days and the biggest
// WP holds 86: one row per photo would bury every decision and every withdrawal
// on exactly the work packages that get the most work.
//
// Days are Bangkok days (src/lib/dates.ts bangkokDateOf), not UTC days — a 20:00
// Thai photo is the same working day as a 09:00 one, and UTC grouping would split
// every evening across two headers.

import { describe, expect, it } from "vitest";
import {
  buildWpTimeline,
  timelineFilterOf,
  type WpTimelineInput,
} from "@/lib/work-packages/wp-timeline";

const NAMES = { u1: "อนัญญา", u2: "วุฒิพงษ์" };

const EMPTY: WpTimelineInput = {
  photos: [],
  approvals: [],
  requests: [],
  issues: [],
  returns: [],
  statuses: [],
  reworkEvents: [],
  names: {},
};

describe("buildWpTimeline", () => {
  it("returns nothing for an empty work package", () => {
    expect(buildWpTimeline(EMPTY)).toEqual([]);
  });

  it("collapses a photo burst into one row per phase per Bangkok day", () => {
    const days = buildWpTimeline({
      ...EMPTY,
      names: NAMES,
      photos: [
        { id: "p1", phase: "during", created_at: "2026-07-22T03:03:00Z", uploaded_by: "u1" },
        { id: "p2", phase: "during", created_at: "2026-07-22T05:20:00Z", uploaded_by: "u1" },
        { id: "p3", phase: "during", created_at: "2026-07-22T08:47:00Z", uploaded_by: "u1" },
        { id: "p4", phase: "after", created_at: "2026-07-22T09:10:00Z", uploaded_by: "u1" },
      ],
    });
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-07-22");
    const during = days[0]!.rows.find((r) => r.kind === "photos" && r.phase === "during");
    expect(during).toMatchObject({ kind: "photos", count: 3, actor: "อนัญญา" });
    // the span is the burst's first and last capture, not a single stamp
    expect(during).toMatchObject({ at: "2026-07-22T03:03:00Z", until: "2026-07-22T08:47:00Z" });
    // a different phase on the same day is its own row, never merged in
    expect(days[0]!.rows.filter((r) => r.kind === "photos")).toHaveLength(2);
  });

  it("groups by Bangkok day, so a late-evening Thai photo does not fall to the next day", () => {
    // 2026-07-22T17:30Z = 2026-07-23 00:30 in Bangkok — a UTC grouping would put
    // these on one day. Bangkok grouping puts them on two.
    const days = buildWpTimeline({
      ...EMPTY,
      photos: [
        { id: "a", phase: "during", created_at: "2026-07-22T16:00:00Z", uploaded_by: null },
        { id: "b", phase: "during", created_at: "2026-07-22T17:30:00Z", uploaded_by: null },
      ],
    });
    expect(days.map((d) => d.date)).toEqual(["2026-07-23", "2026-07-22"]);
  });

  it("renders each approval as its own row carrying reason and comment", () => {
    const days = buildWpTimeline({
      ...EMPTY,
      names: NAMES,
      approvals: [
        {
          id: "a1",
          decision: "needs_revision",
          revision_reason: "mismatch",
          comment: "รูปที่ 3–5 เป็นห้องอื่น",
          decided_at: "2026-07-24T09:40:00Z",
          decided_by: "u2",
        },
      ],
    });
    expect(days[0]!.rows[0]).toMatchObject({
      kind: "decision",
      decision: "needs_revision",
      reason: "mismatch",
      comment: "รูปที่ 3–5 เป็นห้องอื่น",
      actor: "วุฒิพงษ์",
    });
  });

  it("orders days newest first and rows newest first inside a day", () => {
    const days = buildWpTimeline({
      ...EMPTY,
      photos: [{ id: "p", phase: "before", created_at: "2026-07-20T02:00:00Z", uploaded_by: null }],
      issues: [
        {
          id: "i",
          item: "ปูนฉาบ",
          qty: 25,
          unit: "ถุง",
          issued_at: "2026-07-22T01:00:00Z",
          issued_by: null,
        },
      ],
      approvals: [
        {
          id: "a",
          decision: "approved",
          revision_reason: null,
          comment: null,
          decided_at: "2026-07-22T04:00:00Z",
          decided_by: "u2",
        },
      ],
    });
    expect(days.map((d) => d.date)).toEqual(["2026-07-22", "2026-07-20"]);
    expect(days[0]!.rows.map((r) => r.kind)).toEqual(["decision", "issue"]);
  });

  it("maps every row kind to exactly one filter chip", () => {
    // ของ deliberately covers three kinds — a request, a withdrawal and a return
    // are one question to the SA ("what materials touched this WP").
    expect(timelineFilterOf("photos")).toBe("photos");
    expect(timelineFilterOf("decision")).toBe("review");
    expect(timelineFilterOf("request")).toBe("materials");
    expect(timelineFilterOf("issue")).toBe("materials");
    expect(timelineFilterOf("return")).toBe("materials");
    expect(timelineFilterOf("rework")).toBe("status");
  });

  it("gives every row a key that is stable and unique across kinds", () => {
    // Every non-photo kind keys off its source id, and these tables have separate
    // id spaces — an issue and its return legitimately share one. So the SAME id is
    // used across four kinds here: drop any kind prefix and React sees duplicate
    // keys. (Photo rows key off date|phase, not a photo id, so including one here
    // would prove nothing — an earlier version of this test did exactly that and a
    // mutation check caught it staying green.)
    const days = buildWpTimeline({
      ...EMPTY,
      issues: [
        {
          id: "x",
          item: "ทราย",
          qty: 1,
          unit: "คิว",
          issued_at: "2026-07-22T03:00:00Z",
          issued_by: null,
        },
      ],
      returns: [
        {
          id: "x",
          item: "ทราย",
          qty: 1,
          unit: "คิว",
          returned_at: "2026-07-22T04:00:00Z",
          returned_by: null,
        },
      ],
      requests: [
        {
          id: "x",
          pr_number: "PR-1",
          item_description: "ทราย",
          quantity: 1,
          unit: "คิว",
          status: "requested",
          requested_at: "2026-07-22T05:00:00Z",
          requested_by: null,
        },
      ],
      approvals: [
        {
          id: "x",
          decision: "approved",
          revision_reason: null,
          comment: null,
          decided_at: "2026-07-22T06:00:00Z",
          decided_by: "u2",
        },
      ],
    });
    const keys = days.flatMap((d) => d.rows.map((r) => r.key));
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// Spec 363 U2a — status transitions, the rail's backbone. U2b shipped without
// them because audit_log's site-staff SELECT policy is an EVENT ALLOWLIST that
// excludes wp_status_transition (552 rows in 30 days); the new DEFINER RPC
// wp_status_history supplies them, so the builder now takes a `statuses` source.
describe("buildWpTimeline — status transitions (spec 363 U2a)", () => {
  const base = {
    photos: [],
    approvals: [],
    requests: [],
    issues: [],
    returns: [],
    reworkEvents: [],
    statuses: [],
    names: { u1: "สมชาย" },
  };

  function withStatuses(statuses: unknown[]) {
    return buildWpTimeline({
      ...base,
      statuses,
    } as unknown as Parameters<typeof buildWpTimeline>[0]);
  }

  it("renders a status transition as its own row", () => {
    const days = withStatuses([
      {
        at: "2026-07-20T03:00:00Z",
        from_status: "in_progress",
        to_status: "pending_approval",
        actor_id: "u1",
        rework_round: 0,
      },
    ]);
    const rows = days.flatMap((d) => d.rows);
    const row = rows.find((r) => r.kind === "status");
    expect(row).toBeDefined();
    expect(row).toMatchObject({ from: "in_progress", to: "pending_approval", actor: "สมชาย" });
  });

  it("files a status row under the สถานะ filter, beside rework", () => {
    const days = withStatuses([
      {
        at: "2026-07-20T03:00:00Z",
        from_status: "in_progress",
        to_status: "complete",
        actor_id: "u1",
        rework_round: 0,
      },
    ]);
    const row = days.flatMap((d) => d.rows).find((r) => r.kind === "status")!;
    // The filter is DERIVED from the kind, not stored on the row.
    expect(timelineFilterOf(row.kind)).toBe("status");
    // …and it shares the chip with rework, which is the point of the สถานะ chip.
    expect(timelineFilterOf("rework")).toBe("status");
  });

  it("keys status rows uniquely so two transitions on one day both render", () => {
    const days = withStatuses([
      // SAME timestamp on purpose: audit_log rows carry no natural key, and a
      // bulk status change writes several within the same second. Distinct
      // timestamps here would make the key collision untestable — the mutation
      // that drops the index stayed green until this fixture shared a stamp.
      {
        at: "2026-07-20T03:00:00Z",
        from_status: "not_started",
        to_status: "in_progress",
        actor_id: "u1",
        rework_round: 0,
      },
      {
        at: "2026-07-20T03:00:00Z",
        from_status: "in_progress",
        to_status: "pending_approval",
        actor_id: "u1",
        rework_round: 0,
      },
    ]);
    const rows = days.flatMap((d) => d.rows).filter((r) => r.kind === "status");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("renders no status rows for a refused role — [] is the refusal signal", () => {
    // The loader maps the RPC's 42501 to an EMPTY LIST, not undefined, so this is
    // the shape a refused role (plain procurement) actually produces.
    const days = withStatuses([]);
    expect(days.flatMap((d) => d.rows).filter((r) => r.kind === "status")).toEqual([]);
  });
});

describe("buildWpTimeline — reopen is not rendered twice (spec 363 U2a)", () => {
  const at = "2026-07-20T03:00:00Z";
  const base = {
    photos: [],
    approvals: [],
    requests: [],
    issues: [],
    returns: [],
    statuses: [],
    names: { u1: "สมชาย" },
  };

  it("drops the rework row when a status row covers the same moment", () => {
    // reopen_work_package_for_defect writes BOTH rows in one transaction, on the
    // identical created_at, so without this the SA sees the same event twice.
    const days = buildWpTimeline({
      ...base,
      reworkEvents: [{ id: "a1", event: "wp_reopened_for_defect", created_at: at, actor_id: "u1" }],
      statuses: [{ at, from_status: "complete", to_status: "rework", actor_id: "u1" }],
    } as unknown as Parameters<typeof buildWpTimeline>[0]);
    const rows = days.flatMap((d) => d.rows);
    expect(rows.filter((r) => r.kind === "rework")).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "status")).toHaveLength(1);
  });

  it("KEEPS the rework row when no status row covers it", () => {
    // Without the status source (a refused role) the stand-in is all there is.
    const days = buildWpTimeline({
      ...base,
      reworkEvents: [{ id: "a1", event: "wp_reopened_for_defect", created_at: at, actor_id: "u1" }],
    } as unknown as Parameters<typeof buildWpTimeline>[0]);
    expect(days.flatMap((d) => d.rows).filter((r) => r.kind === "rework")).toHaveLength(1);
  });

  it("never drops wp_evidence_resubmitted — it changes no status", () => {
    const days = buildWpTimeline({
      ...base,
      reworkEvents: [
        { id: "a2", event: "wp_evidence_resubmitted", created_at: at, actor_id: "u1" },
      ],
      statuses: [{ at, from_status: "rework", to_status: "pending_approval", actor_id: "u1" }],
    } as unknown as Parameters<typeof buildWpTimeline>[0]);
    expect(days.flatMap((d) => d.rows).filter((r) => r.kind === "rework")).toHaveLength(1);
  });
});
