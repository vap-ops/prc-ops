// Writing failing test first.
//
// Spec 262 U2 — pure presentation/query layer for the procurement report
// (/requests/reports): Thai bucket labels, period-preset resolution, the
// bucket→calendar-window mapping the register drill needs (Asia/Bangkok,
// spec 262 U1's tz carry-over), satang-safe totals (must agree with the
// accounting register's summarizePurchases for the same underlying data),
// per-bucket trend aggregation, the purchaser-slice visibility narrowing,
// and deep-linkable href builders (no client JS — the /projects filter-bar
// pattern).

import { describe, expect, it } from "vitest";

import { formatThaiDate } from "@/lib/i18n/labels";
import { deriveVatBreakdown } from "@/lib/purchasing/vat";
import { summarizePurchases } from "@/lib/accounting/purchases-view";
import {
  bucketLabel,
  bucketWindow,
  resolvePeriod,
  resolveGroupBy,
  availableGroupByOptions,
  mapReportRow,
  summarizeReportRows,
  trendByBucket,
  barPct,
  reportHref,
  registerDrillHref,
  reportRowsToCsv,
  parseReportQuery,
  type PurchaseReportRow,
} from "@/lib/purchasing/purchase-report-view";

describe("bucketLabel", () => {
  it("delegates day buckets to formatThaiDate (the register's date formatter)", () => {
    expect(bucketLabel("day", "2026-07-04")).toBe(formatThaiDate("2026-07-04"));
  });

  it("labels a month bucket as Thai short month + Buddhist year", () => {
    expect(bucketLabel("month", "2026-07-01")).toBe("ก.ค. 2569");
    expect(bucketLabel("month", "2026-01-01")).toBe("ม.ค. 2569");
  });

  it("labels a year bucket as the bare Buddhist year", () => {
    expect(bucketLabel("year", "2026-01-01")).toBe("2569");
  });
});

describe("bucketWindow (the calendar span a bucket value covers, Asia/Bangkok)", () => {
  it("a day bucket spans just that day", () => {
    expect(bucketWindow("day", "2026-07-04")).toEqual({ from: "2026-07-04", to: "2026-07-04" });
  });

  it("a month bucket spans the whole calendar month", () => {
    expect(bucketWindow("month", "2026-07-01")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("a month bucket handles a leap February correctly", () => {
    expect(bucketWindow("month", "2024-02-01")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("a year bucket spans the whole calendar year", () => {
    expect(bucketWindow("year", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("resolvePeriod (presets วันนี้/เดือนนี้/ปีนี้/custom)", () => {
  const today = "2026-07-04";

  it("today = just today", () => {
    expect(resolvePeriod("today", today)).toEqual({ from: today, to: today });
  });

  it("month = month-to-date", () => {
    expect(resolvePeriod("month", today)).toEqual({ from: "2026-07-01", to: today });
  });

  it("year = year-to-date", () => {
    expect(resolvePeriod("year", today)).toEqual({ from: "2026-01-01", to: today });
  });

  it("custom = the given range when valid", () => {
    expect(resolvePeriod("custom", today, "2026-01-15", "2026-02-20")).toEqual({
      from: "2026-01-15",
      to: "2026-02-20",
    });
  });

  it("custom falls back to month-to-date when the range is missing", () => {
    expect(resolvePeriod("custom", today)).toEqual({ from: "2026-07-01", to: today });
  });

  it("custom falls back to month-to-date when the range is inverted", () => {
    expect(resolvePeriod("custom", today, "2026-03-01", "2026-01-01")).toEqual({
      from: "2026-07-01",
      to: today,
    });
  });
});

describe("resolveGroupBy (purchaser-slice defense-in-depth narrowing)", () => {
  it("narrows purchaser away to none for a viewer without the manager tier", () => {
    expect(resolveGroupBy("purchaser", false)).toBe("none");
  });

  it("keeps purchaser for a manager-tier ∪ procurement_manager viewer", () => {
    expect(resolveGroupBy("purchaser", true)).toBe("purchaser");
  });

  it("passes through every other group-by regardless of tier", () => {
    expect(resolveGroupBy("project", false)).toBe("project");
    expect(resolveGroupBy("none", false)).toBe("none");
  });
});

describe("availableGroupByOptions", () => {
  it("excludes purchaser for a viewer without the manager tier", () => {
    expect(availableGroupByOptions(false)).toEqual(["none", "project", "supplier", "category"]);
  });

  it("includes purchaser for the manager tier ∪ procurement_manager", () => {
    expect(availableGroupByOptions(true)).toEqual([
      "none",
      "project",
      "supplier",
      "category",
      "purchaser",
    ]);
  });
});

describe("mapReportRow", () => {
  it("maps the RPC's snake_case row into a camelCase view row with a computed bucket label", () => {
    const row = mapReportRow("month", {
      bucket: "2026-07-01",
      group_key: "p1",
      group_label: "โครงการ A",
      line_gross: 1000,
      charge_gross: 50,
      gross: 1050,
      net: 981.31,
      vat: 68.69,
      pr_count: 3,
    });
    expect(row).toEqual<PurchaseReportRow>({
      bucket: "2026-07-01",
      bucketLabel: "ก.ค. 2569",
      groupKey: "p1",
      groupLabel: "โครงการ A",
      lineGross: 1000,
      chargeGross: 50,
      gross: 1050,
      net: 981.31,
      vat: 68.69,
      prCount: 3,
    });
  });
});

describe("summarizeReportRows (must agree with the register's summarizePurchases)", () => {
  it("sums the same underlying purchases to the same totals as the accounting register", () => {
    // Same fixture as purchases-view.test.ts's summarizePurchases case — each
    // line run through the SAME deriveVatBreakdown the RPC uses, pre-aggregated
    // into report rows (as if group_by='none' produced one row per line).
    const lines = [
      { gross: 107, vatRate: 7 }, // net 100, vat 7
      { gross: 50, vatRate: 0 }, // net 50, vat 0
    ];
    const registerTotals = summarizePurchases(lines);

    const rows: PurchaseReportRow[] = lines.map((l) => {
      const { net, vat, gross } = deriveVatBreakdown(l.gross, l.vatRate);
      return {
        bucket: "2026-07-04",
        bucketLabel: "4 ก.ค. 2569",
        groupKey: "all",
        groupLabel: "ทั้งหมด",
        lineGross: gross,
        chargeGross: 0,
        gross,
        net,
        vat,
        prCount: 1,
      };
    });

    const reportTotals = summarizeReportRows(rows);
    expect(reportTotals.gross).toBe(registerTotals.totalGross);
    expect(reportTotals.net).toBe(registerTotals.totalNet);
    expect(reportTotals.vat).toBe(registerTotals.totalVat);
    expect(reportTotals.count).toBe(registerTotals.count);
  });

  it("is zero for no rows", () => {
    expect(summarizeReportRows([])).toEqual({ gross: 0, net: 0, vat: 0, chargeGross: 0, count: 0 });
  });
});

describe("trendByBucket", () => {
  const row = (bucket: string, label: string, gross: number): PurchaseReportRow => ({
    bucket,
    bucketLabel: label,
    groupKey: "k",
    groupLabel: "l",
    lineGross: gross,
    chargeGross: 0,
    gross,
    net: gross,
    vat: 0,
    prCount: 1,
  });

  it("sums across groups within the same bucket, sorted by bucket ascending", () => {
    const rows = [
      row("2026-08-01", "ส.ค. 2569", 100),
      row("2026-07-01", "ก.ค. 2569", 300),
      row("2026-07-01", "ก.ค. 2569", 50),
    ];
    expect(trendByBucket(rows)).toEqual([
      { bucket: "2026-07-01", bucketLabel: "ก.ค. 2569", gross: 350 },
      { bucket: "2026-08-01", bucketLabel: "ส.ค. 2569", gross: 100 },
    ]);
  });
});

describe("barPct", () => {
  it("scales to the max, clamped 0..100", () => {
    expect(barPct(50, 100)).toBe(50);
    expect(barPct(100, 100)).toBe(100);
    expect(barPct(0, 100)).toBe(0);
  });

  it("is 0 when there is no max (empty/zero series)", () => {
    expect(barPct(0, 0)).toBe(0);
  });
});

describe("reportHref (deep-linkable query builder, no client JS)", () => {
  const state = {
    preset: "month" as const,
    from: "2026-07-01",
    to: "2026-07-04",
    bucket: "day" as const,
    group: "none" as const,
  };

  it("serialises the full state", () => {
    const href = reportHref(state);
    expect(href).toBe(
      "/requests/reports?preset=month&from=2026-07-01&to=2026-07-04&bucket=day&group=none",
    );
  });

  it("applies an override while preserving the rest", () => {
    const href = reportHref(state, { bucket: "month" });
    expect(href).toBe(
      "/requests/reports?preset=month&from=2026-07-01&to=2026-07-04&bucket=month&group=none",
    );
  });

  it("includes the project filter only when set", () => {
    expect(reportHref(state)).not.toContain("project=");
    expect(reportHref({ ...state, projectId: "p1" })).toContain("project=p1");
  });
});

describe("registerDrillHref (bucket×group row → the filtered register)", () => {
  it("links with just the date window for the 'none' group (no dimension)", () => {
    expect(registerDrillHref({ from: "2026-07-01", to: "2026-07-31" })).toBe(
      "/requests/reports/register?from=2026-07-01&to=2026-07-31",
    );
  });

  it("links with the dimension + key for a named slice", () => {
    expect(
      registerDrillHref({ from: "2026-07-01", to: "2026-07-31", dim: "supplier", key: "s1" }),
    ).toBe("/requests/reports/register?from=2026-07-01&to=2026-07-31&dim=supplier&key=s1");
  });

  it("links with unassigned=1 for the null bucket, omitting key", () => {
    expect(
      registerDrillHref({
        from: "2026-07-01",
        to: "2026-07-31",
        dim: "category",
        unassigned: true,
      }),
    ).toBe("/requests/reports/register?from=2026-07-01&to=2026-07-31&dim=category&unassigned=1");
  });
});

describe("parseReportQuery (the page + export route share this — no drift between them)", () => {
  const today = "2026-07-04";

  it("defaults to month-to-date, day bucket, no grouping, no project", () => {
    expect(parseReportQuery({}, today, false)).toEqual({
      preset: "month",
      bucket: "day",
      group: "none",
      from: "2026-07-01",
      to: today,
    });
  });

  it("parses explicit valid params", () => {
    expect(
      parseReportQuery(
        {
          preset: "year",
          bucket: "month",
          group: "supplier",
          project: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        },
        today,
        false,
      ),
    ).toEqual({
      preset: "year",
      bucket: "month",
      group: "supplier",
      projectId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      from: "2026-01-01",
      to: today,
    });
  });

  it("drops a non-UUID project param — hand-typed garbage must never reach the uuid-typed RPC arg", () => {
    expect(parseReportQuery({ project: "garbage" }, today, false)).toEqual({
      preset: "month",
      bucket: "day",
      group: "none",
      from: "2026-07-01",
      to: today,
    });
  });

  it("ignores invalid enum values, falling back to defaults", () => {
    expect(parseReportQuery({ bucket: "century", group: "planet" }, today, true)).toEqual({
      preset: "month",
      bucket: "day",
      group: "none",
      from: "2026-07-01",
      to: today,
    });
  });

  it("narrows purchaser grouping away for a viewer without the manager tier", () => {
    expect(parseReportQuery({ group: "purchaser" }, today, false).group).toBe("none");
    expect(parseReportQuery({ group: "purchaser" }, today, true).group).toBe("purchaser");
  });

  it("resolves a custom range from from/to", () => {
    expect(
      parseReportQuery({ preset: "custom", from: "2026-02-01", to: "2026-02-15" }, today, false),
    ).toEqual({
      preset: "custom",
      bucket: "day",
      group: "none",
      from: "2026-02-01",
      to: "2026-02-15",
    });
  });
});

describe("reportRowsToCsv", () => {
  it("opens with a UTF-8 BOM and Thai headers, one line per row", () => {
    const rows: PurchaseReportRow[] = [
      {
        bucket: "2026-07-01",
        bucketLabel: "ก.ค. 2569",
        groupKey: "p1",
        groupLabel: "โครงการ A",
        lineGross: 1000,
        chargeGross: 50,
        gross: 1050,
        net: 981.31,
        vat: 68.69,
        prCount: 3,
      },
    ];
    const csv = reportRowsToCsv(rows);
    expect(csv.charAt(0)).toBe("﻿");
    const lines = csv.slice(1).trimEnd().split("\n");
    expect(lines[0]).toBe(
      "ช่วงเวลา,กลุ่ม,ยอดตามรายการ,ค่าใช้จ่ายเพิ่มเติม,ยอดรวม,มูลค่าก่อนภาษี,ภาษีมูลค่าเพิ่ม,จำนวนใบขอซื้อ",
    );
    expect(lines[1]).toBe("ก.ค. 2569,โครงการ A,1000.00,50.00,1050.00,981.31,68.69,3");
  });

  it("is just the header for no rows", () => {
    const csv = reportRowsToCsv([]);
    expect(csv.slice(1).trimEnd()).toBe(
      "ช่วงเวลา,กลุ่ม,ยอดตามรายการ,ค่าใช้จ่ายเพิ่มเติม,ยอดรวม,มูลค่าก่อนภาษี,ภาษีมูลค่าเพิ่ม,จำนวนใบขอซื้อ",
    );
  });
});
