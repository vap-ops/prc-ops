// Writing failing test first.
//
// Spec 400 U6a — the worker-day fix screen's pure decisions. Extracted per the
// house rule from U1 onward: a source scan can prove a branch EXISTS, never
// that it is REACHABLE ("if (x)" -> "if (true)" stayed green), so every arm
// that decides what the page offers is driven directly here, not inferred from
// the page's JSX.

import { describe, expect, it } from "vitest";
import {
  canAddMissingSession,
  outTimeLocked,
  parseFixParams,
  undoSessionControl,
} from "@/lib/muster/day-fix";

const WORKER = "aaaaaaaa-1111-1111-1111-111111111111";
const PROJECT = "bbbbbbbb-2222-2222-2222-222222222222";

describe("parseFixParams", () => {
  it("accepts a valid worker + date, with no project", () => {
    expect(parseFixParams({ worker: WORKER, date: "2026-08-04" })).toEqual({
      workerId: WORKER,
      date: "2026-08-04",
      projectId: null,
    });
  });

  it("carries a valid project through", () => {
    expect(parseFixParams({ worker: WORKER, date: "2026-08-04", project: PROJECT })).toEqual({
      workerId: WORKER,
      date: "2026-08-04",
      projectId: PROJECT,
    });
  });

  it("rejects a missing or malformed worker id", () => {
    expect(parseFixParams({ date: "2026-08-04" })).toBeNull();
    expect(parseFixParams({ worker: "not-a-uuid", date: "2026-08-04" })).toBeNull();
  });

  it("rejects a missing, malformed or CALENDAR-invalid date", () => {
    expect(parseFixParams({ worker: WORKER })).toBeNull();
    expect(parseFixParams({ worker: WORKER, date: "04/08/2026" })).toBeNull();
    // Shape-valid, calendar-invalid — the same dead-end class ?start/?end guard
    // against (attendance-audit.ts's isValidIsoDate).
    expect(parseFixParams({ worker: WORKER, date: "2026-02-30" })).toBeNull();
  });

  it("rejects a malformed project id", () => {
    expect(parseFixParams({ worker: WORKER, date: "2026-08-04", project: "nope" })).toBeNull();
  });

  it("treats a repeated key (array value) as absent, not as a crash", () => {
    expect(parseFixParams({ worker: [WORKER, WORKER], date: "2026-08-04" })).toBeNull();
  });
});

describe("outTimeLocked", () => {
  it("is locked once a HUMAN recorded the check-out", () => {
    expect(outTimeLocked({ outAt: "2026-08-04T10:00:00Z", outAuto: false })).toBe(true);
  });

  it("is NOT locked for a fabricated auto-out — that one may be replaced", () => {
    expect(outTimeLocked({ outAt: "2026-08-04T10:00:00Z", outAuto: true })).toBe(false);
  });

  it("is NOT locked when there is no check-out at all yet", () => {
    expect(outTimeLocked({ outAt: null, outAuto: false })).toBe(false);
  });
});

describe("canAddMissingSession", () => {
  it("offers add when there is no session at all", () => {
    expect(canAddMissingSession([])).toBe(true);
  });

  it("offers add when only an ot session exists (orphaned, but no regular yet)", () => {
    expect(canAddMissingSession([{ session: "ot" }])).toBe(true);
  });

  it("refuses add once a regular session exists — the RPC can only create one", () => {
    expect(canAddMissingSession([{ session: "regular" }])).toBe(false);
    expect(canAddMissingSession([{ session: "regular" }, { session: "ot" }])).toBe(false);
  });
});

describe("undoSessionControl", () => {
  it("offers undo on an open day", () => {
    expect(undoSessionControl({ dayClosed: false })).toEqual({ control: "undo" });
  });

  it("withholds undo on a closed day — the RPC refuses outright", () => {
    expect(undoSessionControl({ dayClosed: true })).toEqual({ control: "none", reason: "closed" });
  });
});
