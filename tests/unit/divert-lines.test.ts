// Writing failing test first.
//
// Spec 198 U3 — the row→DivertLine mapping is shared by the คลัง page and the
// delivery page (both list delivered, WP-bound, catalogued PR lines that can be
// moved into the store). toDivertLines maps the PostgREST rows to DivertLine and
// drops any line already diverted (a stock_receipt already stamped with its PR).

import { describe, expect, it } from "vitest";

import { toDivertLines, type DivertPrRow } from "@/lib/store/divert-lines";

const rows: DivertPrRow[] = [
  {
    id: "pr1",
    quantity: 50,
    unit: "ถุง",
    amount: 6500,
    catalog_items: { base_item: "ปูนซีเมนต์", spec_attrs: null },
    work_packages: { code: "WP-01", name: "งานเดินไฟ" },
  },
  {
    id: "pr2",
    quantity: 10,
    unit: "ม้วน",
    amount: 9200,
    catalog_items: { base_item: "สายไฟ NYY", spec_attrs: "3x6" },
    work_packages: { code: "WP-02", name: "งานไฟ" },
  },
];

describe("toDivertLines (spec 198 U3)", () => {
  it("maps PR rows to DivertLine (item + spec, qty, unit, WP label, cost)", () => {
    const out = toDivertLines(rows, new Set());
    expect(out).toEqual([
      {
        requestId: "pr1",
        itemLabel: "ปูนซีเมนต์",
        qty: 50,
        unit: "ถุง",
        wpLabel: "WP-01 งานเดินไฟ",
        cost: 6500,
      },
      {
        requestId: "pr2",
        itemLabel: "สายไฟ NYY · 3x6",
        qty: 10,
        unit: "ม้วน",
        wpLabel: "WP-02 งานไฟ",
        cost: 9200,
      },
    ]);
  });

  it("drops lines already diverted (a stock_receipt stamped with the PR)", () => {
    const out = toDivertLines(rows, new Set(["pr1"]));
    expect(out.map((l) => l.requestId)).toEqual(["pr2"]);
  });

  it("tolerates missing catalog/WP joins and null amount", () => {
    const out = toDivertLines(
      [
        {
          id: "pr3",
          quantity: 3,
          unit: null,
          amount: null,
          catalog_items: null,
          work_packages: null,
        },
      ],
      new Set(),
    );
    expect(out[0]).toEqual({
      requestId: "pr3",
      itemLabel: "",
      qty: 3,
      unit: "",
      wpLabel: "",
      cost: 0,
    });
  });
});
