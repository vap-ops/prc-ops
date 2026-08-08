// Writing failing test first.
//
// Spec 400 U6b — the THREE DOORS into the U6a fix screen, and the pure
// decisions behind them. U6a built `/team/attendance/fix` and left it reachable
// only by typing the URL; this unit makes the grid, the ?day= panel and the
// spec-374 calendar link to it, and makes an unfinished correction loop visible.
//
// Every decision lives here rather than inside a component, for the reason U1
// paid for twice: a source scan proves a branch EXISTS, never that it is
// REACHABLE (`if (canOpenCalendar)` -> `if (true)` stayed green across the whole
// suite), so each arm is driven directly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dayWorkList,
  fixHref,
  gridCellFixable,
  parseFixParams,
  unfinishedDays,
} from "@/lib/muster/day-fix";
import type { GridDay } from "@/lib/muster/attendance-grid";

const WORKER = "aaaaaaaa-1111-1111-1111-111111111111";
const PROJECT = "bbbbbbbb-2222-2222-2222-222222222222";

/** A day with attendance, closed, working — the boring baseline every case
 *  below varies exactly one field of. */
function day(over: Partial<GridDay> = {}): GridDay {
  return {
    date: "2026-08-04",
    nonWorking: false,
    holidayName: null,
    headcount: 12,
    dayClosed: true,
    ...over,
  };
}

describe("fixHref", () => {
  it("carries worker, date, project and the referrer", () => {
    const href = fixHref({
      workerId: WORKER,
      date: "2026-08-04",
      projectId: PROJECT,
      backHref: "/team/attendance?start=2026-08-01&end=2026-08-07",
    });
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe("/team/attendance/fix");
    expect(url.searchParams.get("worker")).toBe(WORKER);
    expect(url.searchParams.get("date")).toBe("2026-08-04");
    expect(url.searchParams.get("project")).toBe(PROJECT);
    expect(url.searchParams.get("from")).toBe("/team/attendance?start=2026-08-01&end=2026-08-07");
  });

  it("omits project entirely when there is none, rather than sending an empty one", () => {
    // `parseFixParams` fails the WHOLE parse on a malformed project, and "" is
    // not a uuid — so `?project=` would turn a working link into a dead one.
    const href = fixHref({
      workerId: WORKER,
      date: "2026-08-04",
      projectId: null,
      backHref: "/team",
    });
    expect(href).not.toContain("project=");
    expect(new URL(href, "https://x.test").searchParams.has("project")).toBe(false);
  });

  it("round-trips through parseFixParams, the reader of this very URL", () => {
    // Supplementary, not the primary pin: builder and parser share a module, so
    // this cannot catch a wrong PARAM NAME on its own (the assertions above pin
    // the literal names). It catches an encoding mistake between the two.
    const href = fixHref({
      workerId: WORKER,
      date: "2026-08-04",
      projectId: PROJECT,
      backHref: "/team/attendance?start=2026-08-01",
    });
    const q = new URL(href, "https://x.test").searchParams;
    expect(
      parseFixParams({
        worker: q.get("worker") ?? undefined,
        date: q.get("date") ?? undefined,
        project: q.get("project") ?? undefined,
      }),
    ).toEqual({ workerId: WORKER, date: "2026-08-04", projectId: PROJECT });
  });

  it("encodes a referrer that itself carries a query string", () => {
    const href = fixHref({
      workerId: WORKER,
      date: "2026-08-04",
      projectId: null,
      backHref: "/team/attendance?start=2026-08-01&project=x&day=2026-08-04",
    });
    // The `&` of the INNER url must not read as a param of the outer one.
    expect(new URL(href, "https://x.test").searchParams.get("from")).toBe(
      "/team/attendance?start=2026-08-01&project=x&day=2026-08-04",
    );
  });
});

describe("gridCellFixable", () => {
  it("links a cell whose session carries a finding", () => {
    expect(
      gridCellFixable({ hasSession: true, hasFindings: true, day: day(), canFixGaps: true }),
    ).toBe(true);
  });

  it("links a finding cell even on a CLOSED day — retime's own guard is the wage anti-join", () => {
    // muster_correct_session's UPDATE path was built for the nine 2026-07-24 OT
    // rows, which sit on a closed day. Gating the link on closure would put the
    // page's whole reason for existing out of reach.
    expect(
      gridCellFixable({
        hasSession: true,
        hasFindings: true,
        day: day({ dayClosed: true }),
        canFixGaps: true,
      }),
    ).toBe(true);
  });

  it("links a finding cell even with no project picked — the page infers it from the session", () => {
    // fix/page.tsx: `projectParam ?? sessions[0]?.projectId ?? null`. A cell
    // exists only because a session does, so inference cannot fail here.
    expect(
      gridCellFixable({ hasSession: true, hasFindings: true, day: day(), canFixGaps: false }),
    ).toBe(true);
  });

  it("does NOT link a clean session cell — the grid's doors are findings and gaps", () => {
    expect(
      gridCellFixable({ hasSession: true, hasFindings: false, day: day(), canFixGaps: true }),
    ).toBe(false);
  });

  it("links an EMPTY cell on a working day that has a team", () => {
    expect(
      gridCellFixable({ hasSession: false, hasFindings: false, day: day(), canFixGaps: true }),
    ).toBe(true);
  });

  it("does NOT link an empty cell when no project is picked — add needs a project the page cannot infer", () => {
    // With no session there is nothing to infer the project FROM, so the fix
    // page would render its `noProject` arm and offer nothing: a link that
    // promises a correction and delivers a sentence.
    expect(
      gridCellFixable({ hasSession: false, hasFindings: false, day: day(), canFixGaps: false }),
    ).toBe(false);
  });

  it("does NOT link an empty cell on a non-working day — an empty Sunday is not a finding", () => {
    // The shading rule exists so an empty Sunday does not read as a hole; a tap
    // target on all 41 of them would re-create exactly that, one layer up.
    expect(
      gridCellFixable({
        hasSession: false,
        hasFindings: false,
        day: day({ nonWorking: true }),
        canFixGaps: true,
      }),
    ).toBe(false);
    expect(
      gridCellFixable({
        hasSession: false,
        hasFindings: false,
        day: day({ nonWorking: true, holidayName: "วันแม่" }),
        canFixGaps: true,
      }),
    ).toBe(false);
  });

  it("does NOT link an empty cell on a day with NO team at all", () => {
    // headcount 0 means nobody was scanned, so no muster team exists for the
    // day — `list_muster_teams_for_day` returns nothing and the add form's own
    // `noTeams` arm is all the reader would get.
    expect(
      gridCellFixable({
        hasSession: false,
        hasFindings: false,
        day: day({ headcount: 0, dayClosed: null }),
        canFixGaps: true,
      }),
    ).toBe(false);
  });
});

describe("unfinishedDays", () => {
  const TODAY = "2026-08-07";

  it("names a past day that carries attendance and is not closed", () => {
    expect(
      unfinishedDays([day({ date: "2026-08-04", dayClosed: false })], TODAY).map((d) => d.date),
    ).toEqual(["2026-08-04"]);
  });

  it("ignores a closed past day", () => {
    expect(unfinishedDays([day({ date: "2026-08-04", dayClosed: true })], TODAY)).toEqual([]);
  });

  it("ignores TODAY, whose open day is the normal state", () => {
    // This is the cry-wolf line the U1 review drew at the column header: the
    // default range always includes today, so an amber banner keyed on
    // `dayClosed === false` alone would fire every single day forever.
    expect(unfinishedDays([day({ date: TODAY, dayClosed: false })], TODAY)).toEqual([]);
  });

  it("ignores a FUTURE day", () => {
    expect(unfinishedDays([day({ date: "2026-08-09", dayClosed: false })], TODAY)).toEqual([]);
  });

  it("ignores a day with no attendance at all — nobody scanned is not an open day", () => {
    // `dayClosed === null` is the grid's own third state and must not collapse
    // into `false`: 2026-08-06 live has zero rows, and calling it unfinished
    // would invent a correction nobody owes.
    expect(
      unfinishedDays([day({ date: "2026-08-06", dayClosed: null, headcount: 0 })], TODAY),
    ).toEqual([]);
  });

  it("returns the days in the order given, so the banner reads chronologically", () => {
    const days = [
      day({ date: "2026-08-03", dayClosed: false }),
      day({ date: "2026-08-04", dayClosed: true }),
      day({ date: "2026-08-05", dayClosed: false }),
    ];
    expect(unfinishedDays(days, TODAY).map((d) => d.date)).toEqual(["2026-08-03", "2026-08-05"]);
  });

  it("is empty for the live shape measured 2026-08-07 — 13 past days, every one closed", () => {
    // The banner's fire rate is a design fact, not an implementation detail: a
    // signal that fires on every row is the failure the shading rule exists to
    // prevent, so it is pinned as a property of real data.
    const live = [
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ].map((date) => day({ date, dayClosed: true }));
    expect(unfinishedDays(live, TODAY)).toEqual([]);
  });
});

describe("dayWorkList", () => {
  const session = (over: Partial<Parameters<typeof dayWorkList>[0]["sessions"][number]> = {}) => ({
    workerId: "s1",
    workerName: "สมชาย",
    stillIn: false,
    session: "regular" as const,
    ...over,
  });

  it("names a worker whose session was never checked out", () => {
    expect(dayWorkList({ sessions: [session({ stillIn: true })] })).toEqual([
      { workerId: "s1", workerName: "สมชาย", problem: "openOut" },
    ]);
  });

  it("ignores a clean session — a work-list of everybody is not a work-list", () => {
    expect(dayWorkList({ sessions: [session()] })).toEqual([]);
  });

  it("lists a worker with TWO open sessions ONCE", () => {
    // Spec 351 lets a date carry a regular AND an OT row, and both can be open.
    // One person is one row of work, not two.
    expect(
      dayWorkList({
        sessions: [
          session({ stillIn: true, session: "regular" }),
          session({ stillIn: true, session: "ot" }),
        ],
      }),
    ).toEqual([{ workerId: "s1", workerName: "สมชาย", problem: "openOut" }]);
  });

  it("is alphabetical, so the order is not an accident of the query", () => {
    const out = dayWorkList({
      sessions: [
        session({ workerId: "s2", workerName: "ขจร", stillIn: true }),
        session({ workerId: "s1", workerName: "กมล", stillIn: true }),
      ],
    });
    expect(out.map((r) => r.workerName)).toEqual(["กมล", "ขจร"]);
  });

  it("is empty when every session closed cleanly — the state of ALL live data today", () => {
    // Measured 2026-08-07: zero sessions with a null out_at exist database-wide,
    // so this renders empty everywhere right now. Spec 400's "23 of 67 August
    // sessions have no check-out" and U4's "nine stuck 2026-07-24 OT rows" are
    // HISTORY — both were re-measured and are closed. The state still recurs on
    // any live working day, which is what this list is for.
    expect(dayWorkList({ sessions: [session(), session({ workerId: "s2" })] })).toEqual([]);
  });

  it("has NO arm for an unscanned rostered worker — absence is not a day-grain finding", () => {
    // The U6 plan asked for `ไม่มีการเช็คชื่อ` rows here. Measured on the live
    // TFM โพธิ์ทอง roster, 2026-08-01..05 would have produced 23·16·15·20·15 such
    // rows against 0 open check-outs — so a fully-closed day with all 23 people
    // mustered would still have listed 15 people, under a heading reading
    // ต้องแก้ไข, who simply were not scheduled. That is D5's cry-wolf failure.
    // Absence is a RANGE-level finding the grid states, where a gap cell's `+` is
    // an OFFER rather than a claim.
    //
    // Pinned as an EXHAUSTIVE domain check, not an absence: a kind added later
    // must be a deliberate act that reds here first.
    const problems = new Set(
      dayWorkList({
        sessions: [session({ stillIn: true }), session({ workerId: "s2", stillIn: false })],
      }).map((r) => r.problem),
    );
    expect([...problems]).toEqual(["openOut"]);
  });
});

// Writing failing test first.
//
// Spec 400 U7 — the grid's OWN doors now open the panel on this same page; the
// /team/attendance/fix route stays for links minted elsewhere and for anything
// already in the wild.
//
// ⚠️ This pin exists because changing every cell link from the route to the panel
// left the whole suite GREEN. The U6b door tests cover `fixHref` — the pure
// helper — and nothing asserted which helper the PAGE actually calls, which is
// the one thing a reader's tap depends on.
describe("spec 400 U7 — the grid's cells open the panel, not the route", () => {
  const GRID = readFileSync(join(process.cwd(), "src/app/team/attendance/page.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("routes a cell tap and a work-list row through panelFixHref", () => {
    expect(GRID).toMatch(/const cellFixHref[\s\S]{0,120}panelFixHref\(/);
    expect(GRID).toMatch(/const workItemFixHref[\s\S]{0,120}panelFixHref\(/);
    // …and the page no longer mints a route URL for its own cells.
    expect(GRID).not.toContain("fixHref({");
  });

  it("builds the panel URL on THIS page, carrying the day it belongs to", () => {
    const block = GRID.slice(
      GRID.indexOf("const panelFixHref"),
      GRID.indexOf("const panelFixHref") + 700,
    );
    expect(block).toContain('q.set("day", date)');
    expect(block).toContain('q.set("fix", workerId)');
    // The advance flag is set by a WRITE's returnTo only — a reader who taps a
    // cell has not saved anything to advance from.
    expect(block).toMatch(/if \(advance\) q\.set\("fixNext", "1"\)/);
    expect(block).toContain("/team/attendance?");
  });
});
