import { describe, it, expect } from "vitest";
import { filterIncomingLens, parseIncomingLens } from "@/lib/purchasing/request-bands";
import type { Database } from "@/lib/db/database.types";

type PRStatus = Database["public"]["Enums"]["purchase_request_status"];
const row = (status: PRStatus, eta: string | null) => ({ status, eta });
const TODAY = "2026-07-12";

describe("parseIncomingLens", () => {
  it("defaults to today for unknown/empty", () => {
    expect(parseIncomingLens(null)).toBe("today");
    expect(parseIncomingLens("garbage")).toBe("today");
  });
  it("accepts the known lenses", () => {
    expect(parseIncomingLens("onroute")).toBe("onroute");
    expect(parseIncomingLens("all")).toBe("all");
  });
});

describe("filterIncomingLens", () => {
  it("today = due-or-overdue OR no ETA (any incoming status)", () => {
    const items = [
      row("on_route", "2026-07-11"), // overdue -> in
      row("purchased", "2026-07-12"), // today -> in
      row("on_route", "2026-07-13"), // future -> out
      row("purchased", null), // unknown ETA -> in
    ];
    const kept = filterIncomingLens(items, "today", TODAY);
    expect(kept).toHaveLength(3);
    expect(kept).not.toContainEqual(row("on_route", "2026-07-13"));
  });
  it("onroute = only on_route status", () => {
    const items = [row("on_route", "2026-07-20"), row("purchased", "2026-07-11")];
    const kept = filterIncomingLens(items, "onroute", TODAY);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.status).toBe("on_route");
  });
  it("all = every incoming row unchanged", () => {
    const items = [row("on_route", "2026-07-20"), row("purchased", null)];
    expect(filterIncomingLens(items, "all", TODAY)).toHaveLength(2);
  });
  it("today with null todayIso keeps only no-ETA rows (no false 'due')", () => {
    const items = [row("on_route", "2026-07-11"), row("purchased", null)];
    const kept = filterIncomingLens(items, "today", null);
    expect(kept).toEqual([row("purchased", null)]);
  });
});
