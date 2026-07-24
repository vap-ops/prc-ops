// Writing failing test first.
//
// Spec 306 ปิดวัน discoverability — the pure state machine behind the sticky
// close-day bar. Day-1 field failure: the SA manually checked everyone out (the
// day felt done) but never pressed ปิดวัน → no closure → the money derive never
// fired. The bar must highlight at the exact moment the SA's own actions say
// "done" = every checked-in worker is checked out.

import { describe, expect, it } from "vitest";
import { deriveCloseDayState } from "@/lib/muster/close-day-state";

const member = (
  over: Partial<{
    inAt: string | null;
    outAt: string | null;
    ot: { inAt: string | null; outAt: string | null } | null;
  }> = {},
) => ({
  inAt: "2026-07-24T01:00:00Z",
  outAt: null,
  ot: null,
  ...over,
});
const team = (members: ReturnType<typeof member>[]) => ({ members });

describe("deriveCloseDayState", () => {
  it("checked-in, not yet out, before day-end → in_progress with the still-in count", () => {
    const s = deriveCloseDayState({
      teams: [team([member(), member()])],
      closure: null,
      pastDayEnd: false,
    });
    expect(s.kind).toBe("in_progress");
    expect(s.stillIn).toBe(2);
  });

  it("every checked-in worker checked out → ready (the 'done' moment), regardless of time", () => {
    const s = deriveCloseDayState({
      teams: [
        team([
          member({ outAt: "2026-07-24T10:00:00Z" }),
          member({ outAt: "2026-07-24T10:01:00Z" }),
        ]),
      ],
      closure: null,
      pastDayEnd: false,
    });
    expect(s.kind).toBe("ready");
    expect(s.stillIn).toBe(0);
  });

  it("past day-end AND all checked out → ready, not overdue (the normal end-of-day close)", () => {
    // The common path: workers finish at ~17:00, all get checked out, and it is
    // now past day-end. ready must win over overdue — a branch reorder would
    // silently downgrade the primary close prompt to an amber reminder.
    const s = deriveCloseDayState({
      teams: [team([member({ outAt: "2026-07-24T10:02:00Z" })])],
      closure: null,
      pastDayEnd: true,
    });
    expect(s.kind).toBe("ready");
  });

  it("past day-end with workers still in → overdue (auto-out backstop covers stragglers)", () => {
    const s = deriveCloseDayState({
      teams: [team([member(), member({ outAt: "2026-07-24T10:00:00Z" })])],
      closure: null,
      pastDayEnd: true,
    });
    expect(s.kind).toBe("overdue");
    expect(s.stillIn).toBe(1);
  });

  it("a closure present → closed, even if someone re-checked in afterwards", () => {
    const s = deriveCloseDayState({
      teams: [team([member()])],
      closure: { closedAt: "2026-07-24T10:09:00Z" },
      pastDayEnd: true,
    });
    expect(s.kind).toBe("closed");
    expect(s.closedAt).toBe("2026-07-24T10:09:00Z");
  });

  it("ready needs a real attendance — an empty team is not 'ready'", () => {
    const s = deriveCloseDayState({ teams: [team([])], closure: null, pastDayEnd: false });
    expect(s.kind).toBe("in_progress");
    expect(s.stillIn).toBe(0);
  });

  it("counts open OT sessions (in, no out) and ignores closed ones", () => {
    const s = deriveCloseDayState({
      teams: [
        team([
          member({
            outAt: "2026-07-24T10:00:00Z",
            ot: { inAt: "2026-07-24T10:30:00Z", outAt: null },
          }),
          member({
            outAt: "2026-07-24T10:00:00Z",
            ot: { inAt: "2026-07-24T10:30:00Z", outAt: "2026-07-24T12:00:00Z" },
          }),
        ]),
      ],
      closure: null,
      pastDayEnd: false,
    });
    expect(s.kind).toBe("ready");
    expect(s.openOt).toBe(1);
  });
});
