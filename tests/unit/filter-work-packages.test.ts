import { describe, expect, it } from "vitest";

import {
  filterWorkPackages,
  type SearchableWorkPackage,
} from "@/lib/work-packages/filter-work-packages";

const wp = (over: Partial<SearchableWorkPackage> = {}): SearchableWorkPackage => ({
  code: "WP-01-01",
  name: "งาน",
  isGroup: false,
  priorityRank: 0,
  ...over,
});

describe("filterWorkPackages (spec 293)", () => {
  it("matches on WP code, case-insensitive substring", () => {
    const items = [
      wp({ code: "WP-01-07", name: "งานตีฝัง" }),
      wp({ code: "WP-02-03", name: "งานเทคอนกรีต" }),
    ];
    expect(filterWorkPackages(items, "01-07").map((w) => w.code)).toEqual(["WP-01-07"]);
    expect(filterWorkPackages(items, "wp-02").map((w) => w.code)).toEqual(["WP-02-03"]);
  });

  it("matches on WP name substring", () => {
    const items = [
      wp({ code: "WP-01-07", name: "งานตีฝังระดับ" }),
      wp({ code: "WP-02-03", name: "งานเทคอนกรีต" }),
    ];
    expect(filterWorkPackages(items, "คอนกรีต").map((w) => w.code)).toEqual(["WP-02-03"]);
  });

  it("excludes งาน groups even when they match the query", () => {
    const items = [
      wp({ code: "WP-01", name: "กลุ่มงาน", isGroup: true }),
      wp({ code: "WP-01-07", name: "งานย่อย" }),
    ];
    expect(filterWorkPackages(items, "WP-01").map((w) => w.code)).toEqual(["WP-01-07"]);
  });

  it("trims whitespace and treats a blank query as no filter (all leaves, ranked)", () => {
    const items = [wp({ code: "A", priorityRank: 2 }), wp({ code: "B", priorityRank: 1 })];
    expect(filterWorkPackages(items, "   ").map((w) => w.code)).toEqual(["B", "A"]);
  });

  it("orders results by priorityRank ascending", () => {
    const items = [
      wp({ code: "WP-9", name: "งานเก้า", priorityRank: 5 }),
      wp({ code: "WP-1", name: "งานหนึ่ง", priorityRank: 1 }),
    ];
    expect(filterWorkPackages(items, "งาน").map((w) => w.code)).toEqual(["WP-1", "WP-9"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterWorkPackages([wp()], "zzz")).toEqual([]);
  });
});
