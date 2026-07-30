// Writing failing test first.
//
// Spec 384 U1 — the ต้องแก้ไข section receives the PM's SWEEP (12–16 bounces at
// once, most carrying the same reason), not a trickle. `groupSaActions` splits it
// into a stale band that is always shown and per-reason groups the surface can
// collapse.
//
// The invariant the whole surface rests on is CONTIGUITY: nothing inside a group
// may be older than the stale boundary, or the band would assert something false
// about the rows below it (the spec-375 divider lesson, applied to a band instead
// of a rule). No per-row assertion catches that, so it gets its own test.

import { describe, expect, it } from "vitest";

import {
  groupSaActions,
  staleCutoffIso,
  staleCutoffFromNow,
  STALE_ACTION_DAYS,
  type SaActionItem,
} from "@/lib/sa/action-list";

const NOW = Date.parse("2026-07-31T09:00:00.000Z");
const CUTOFF = staleCutoffIso(NOW);

/** `days` before NOW, in the PostgREST encoding (`+00:00`, NOT `Z`). */
function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString().replace("Z", "+00:00");
}

function item(over: Partial<SaActionItem> & Pick<SaActionItem, "id" | "kind">): SaActionItem {
  return {
    code: over.id.toUpperCase(),
    name: `งาน ${over.id}`,
    projectId: "p1",
    projectCode: "PRC-01",
    projectName: "โครงการ",
    reason: null,
    source: null,
    round: null,
    revisionReason: null,
    sinceIso: null,
    ...over,
  };
}

describe("groupSaActions — the stale band", () => {
  it("bands rows older than the boundary and leaves the fresh sweep in groups", () => {
    const { stale, groups } = groupSaActions({
      items: [
        item({ id: "fresh", kind: "revision", revisionReason: "incomplete", sinceIso: daysAgo(1) }),
        item({ id: "old", kind: "revision", revisionReason: "incomplete", sinceIso: daysAgo(9) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(stale.map((i) => i.id)).toEqual(["old"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(["fresh"]);
  });

  it("orders the band oldest first", () => {
    const { stale } = groupSaActions({
      items: [
        item({ id: "b", kind: "revision", sinceIso: daysAgo(7) }),
        item({ id: "a", kind: "revision", sinceIso: daysAgo(10) }),
        item({ id: "c", kind: "revision", sinceIso: daysAgo(6) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(stale.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("CONTIGUITY: no row inside any group is older than the boundary", () => {
    const ages = [0, 1, 2, 3, 4, 6, 9, 14];
    const { groups } = groupSaActions({
      items: ages.map((d, i) =>
        item({ id: `w${i}`, kind: "revision", revisionReason: "mismatch", sinceIso: daysAgo(d) }),
      ),
      staleBeforeIso: CUTOFF,
    });
    for (const g of groups) {
      for (const it of g.items) {
        expect(Date.parse(it.sinceIso!)).toBeGreaterThanOrEqual(Date.parse(CUTOFF));
      }
    }
  });

  it("an unknown age is never stale — 'unknown' is not 'old'", () => {
    // Live shape: a rework WP whose wp_reopened_for_defect audit row is missing.
    // `reopens` is 2 lifetime, so this arm is real and unexercised.
    const { stale, groups } = groupSaActions({
      items: [item({ id: "noage", kind: "rework", sinceIso: null })],
      staleBeforeIso: CUTOFF,
    });
    expect(stale).toEqual([]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["noage"]);
  });

  it("treats an unparseable timestamp as unknown, never as NaN", () => {
    // NaN would leak into the comparator (`NaN - x` is NaN), and a comparator
    // that returns NaN gives an implementation-defined order — a whole group
    // could silently shuffle. Unknown is both safe and honest.
    const { stale, groups } = groupSaActions({
      items: [
        item({ id: "bad", kind: "rework", sinceIso: "not-a-timestamp" }),
        item({ id: "good", kind: "rework", sinceIso: daysAgo(1) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(stale).toEqual([]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["good", "bad"]);
  });

  it("renders no groups at all when every row is stale", () => {
    const { stale, groups } = groupSaActions({
      items: [
        item({ id: "a", kind: "revision", sinceIso: daysAgo(9) }),
        item({ id: "b", kind: "rework", sinceIso: daysAgo(6) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(stale.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups).toEqual([]);
  });

  it("compares INSTANTS, not strings — the two sides use different encodings", () => {
    // PostgREST returns `…+00:00`; the cutoff is built by toISOString() (`…Z`),
    // and `"+" (0x2B) < "Z" (0x5A)` bytewise. A row sitting exactly ON the
    // boundary is where a lexicographic compare goes wrong (spec 375 U1).
    const onBoundary = CUTOFF.replace("Z", "+00:00");
    const { stale } = groupSaActions({
      items: [item({ id: "edge", kind: "revision", sinceIso: onBoundary })],
      staleBeforeIso: CUTOFF,
    });
    expect(stale).toEqual([]);
  });
});

describe("groupSaActions — the group key is total", () => {
  it("keys a reasoned revision by its reason and a reasonless one by the decision", () => {
    // `approvals_revision_reason_forbidden_unless_needs_revision` only FORBIDS a
    // reason outside needs_revision — it does not REQUIRE one, so a reasonless
    // bounce stays writable and must land in a group rather than vanish.
    const { groups } = groupSaActions({
      items: [
        item({ id: "a", kind: "revision", revisionReason: "incomplete", sinceIso: daysAgo(1) }),
        item({ id: "b", kind: "revision", revisionReason: "mismatch", sinceIso: daysAgo(1) }),
        item({ id: "c", kind: "revision", revisionReason: "premature", sinceIso: daysAgo(1) }),
        item({ id: "d", kind: "revision", sinceIso: daysAgo(1) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(groups.map((g) => g.key).sort()).toEqual([
      "revision",
      "revision:incomplete",
      "revision:mismatch",
      "revision:premature",
    ]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(4);
  });

  it("keeps rejected and rework in their own groups", () => {
    const { groups } = groupSaActions({
      items: [
        item({ id: "a", kind: "rejected", sinceIso: daysAgo(1) }),
        item({ id: "b", kind: "rework", sinceIso: daysAgo(1) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(groups.map((g) => g.key)).toEqual(["rejected", "rework"]);
  });

  it("puts every item in exactly one group", () => {
    const items = [
      item({ id: "a", kind: "rejected", sinceIso: daysAgo(1) }),
      item({ id: "b", kind: "rework", sinceIso: null }),
      item({ id: "c", kind: "revision", revisionReason: "mismatch", sinceIso: daysAgo(2) }),
      item({ id: "d", kind: "revision", sinceIso: daysAgo(9) }),
    ];
    const { stale, groups } = groupSaActions({ items, staleBeforeIso: CUTOFF });
    const seen = [...stale, ...groups.flatMap((g) => g.items)].map((i) => i.id).sort();
    expect(seen).toEqual(["a", "b", "c", "d"]);
  });
});

describe("groupSaActions — ordering", () => {
  it("orders groups by severity first, then oldest member", () => {
    const { groups } = groupSaActions({
      items: [
        item({ id: "r1", kind: "revision", revisionReason: "mismatch", sinceIso: daysAgo(1) }),
        item({ id: "r2", kind: "revision", revisionReason: "incomplete", sinceIso: daysAgo(3) }),
        item({ id: "rw", kind: "rework", sinceIso: daysAgo(1) }),
        item({ id: "rj", kind: "rejected", sinceIso: daysAgo(1) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    // KIND_ORDER: rejected → rework → revision; the two revision groups then sort
    // by their oldest member, so `incomplete` (3 days) precedes `mismatch` (1).
    expect(groups.map((g) => g.key)).toEqual([
      "rejected",
      "rework",
      "revision:incomplete",
      "revision:mismatch",
    ]);
  });

  it("orders rows inside a group oldest first, unknown ages last", () => {
    const { groups } = groupSaActions({
      items: [
        item({ id: "young", kind: "rework", sinceIso: daysAgo(1) }),
        item({ id: "unknown", kind: "rework", sinceIso: null }),
        item({ id: "older", kind: "rework", sinceIso: daysAgo(3) }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["older", "young", "unknown"]);
  });

  it("falls back to the legacy project/code order when two rows share an age", () => {
    const same = daysAgo(1);
    const { groups } = groupSaActions({
      items: [
        item({ id: "b", kind: "rework", code: "W02", projectCode: "PRC-B", sinceIso: same }),
        item({ id: "a", kind: "rework", code: "W01", projectCode: "PRC-A", sinceIso: same }),
      ],
      staleBeforeIso: CUTOFF,
    });
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupSaActions({ items: [], staleBeforeIso: CUTOFF })).toEqual({
      stale: [],
      groups: [],
    });
  });
});

describe("the stale cutoff", () => {
  it("returns the ISO instant STALE_ACTION_DAYS before the given clock", () => {
    const now = Date.parse("2026-07-31T09:00:00.000Z");
    expect(staleCutoffIso(now, 3)).toBe("2026-07-28T09:00:00.000Z");
    expect(staleCutoffIso(now)).toBe(staleCutoffIso(now, STALE_ACTION_DAYS));
  });

  it("staleCutoffFromNow reads the clock so the page body does not", () => {
    // The React Compiler lint rejects an impure call in a render body, so the
    // clock read lives here and the grouping stays a pure function of a cutoff.
    const before = Date.now();
    const cutoff = Date.parse(staleCutoffFromNow());
    expect(cutoff).toBeLessThanOrEqual(before - STALE_ACTION_DAYS * 24 * 60 * 60 * 1000 + 1000);
  });
});
