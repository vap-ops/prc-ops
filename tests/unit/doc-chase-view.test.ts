// Spec 380 U3 — the chase-page view model. Pure derivation from raw order rows
// (supplier flag + attachments + waiver + aging inputs) to supplier groups; the
// page is a thin IO shell over THIS, so the grouping/sorting/summary logic is
// testable without RSC rendering (the "gate lives in the page" class).
import { describe, expect, it } from "vitest";

import { DOC_CHASE_ASK_NON_VAT, DOC_CHASE_ASK_VAT } from "@/lib/i18n/labels";
import {
  assembleDocChaseOrders,
  buildDocChaseView,
  countMissingByProject,
  type DocChaseOrderInput,
} from "@/lib/purchasing/doc-chase-view";

const NOW = Date.parse("2026-07-30T05:00:00Z");

const order = (over: Partial<DocChaseOrderInput>): DocChaseOrderInput => ({
  id: "id-1",
  prNumber: 260001,
  itemDescription: "เหล็กข้ออ้อย",
  supplierName: "ร้านทดสอบ",
  supplier: { isVatRegistered: true },
  status: "delivered",
  attachments: [],
  waived: false,
  deliveredAt: "2026-07-10T05:00:00+00:00",
  purchasedAt: null,
  createdAt: "2026-07-01T00:00:00+00:00",
  ...over,
});

describe("buildDocChaseView", () => {
  it("groups missing orders by supplier, biggest debt first, oldest row first inside", () => {
    const view = buildDocChaseView(
      [
        order({ id: "a1", supplierName: "ร้าน ก", deliveredAt: "2026-07-28T05:00:00+00:00" }),
        order({ id: "a2", supplierName: "ร้าน ก", deliveredAt: "2026-07-05T05:00:00+00:00" }),
        order({ id: "b1", supplierName: "ร้าน ข" }),
        order({ id: "c1", supplierName: "ร้าน ก", deliveredAt: "2026-07-20T05:00:00+00:00" }),
      ],
      NOW,
    );
    expect(view.groups.map((g) => g.supplier)).toEqual(["ร้าน ก", "ร้าน ข"]);
    expect(view.groups[0]?.rows.map((r) => r.id)).toEqual(["a2", "c1", "a1"]);
    expect(view.groups[0]?.oldestDays).toBe(25);
  });

  it("covered and out-of-scope orders never reach the chase groups; waived collect separately", () => {
    const view = buildDocChaseView(
      [
        order({ id: "m1" }),
        order({
          id: "cov",
          attachments: [{ docType: "tax_invoice_full", source: "po", purpose: "source_document" }],
        }),
        order({ id: "loose", attachments: [{ docType: null, source: "pr", purpose: "invoice" }] }),
        order({ id: "w1", waived: true }),
        order({ id: "pre", status: "approved" }),
      ],
      NOW,
    );
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(["m1"]);
    expect(view.waived.map((r) => r.id)).toEqual(["w1"]);
    expect(view.summary.missing).toBe(1);
    expect(view.summary.waived).toBe(1);
  });

  it("summary counts >14-day rows and distinct suppliers; no-supplier rows group under the free-text name", () => {
    const view = buildDocChaseView(
      [
        order({ id: "o1", deliveredAt: "2026-07-01T05:00:00+00:00" }),
        order({ id: "o2", deliveredAt: "2026-07-29T05:00:00+00:00", supplierName: "ร้าน ข" }),
        order({ id: "o3", supplierName: null, supplier: null }),
      ],
      NOW,
    );
    expect(view.summary.missing).toBe(3);
    // o1 = 29d, o3 = default 20d (both >14); o2 = 1d
    expect(view.summary.over14).toBe(2);
    expect(view.summary.suppliers).toBe(3);
    expect(view.groups.map((g) => g.supplier)).toContain("ไม่ระบุร้านค้า");
  });

  it("each group carries the per-class ask and doc-state flags per row", () => {
    const view = buildDocChaseView(
      [
        order({ id: "v1", supplierName: "VAT ร้าน", supplier: { isVatRegistered: true } }),
        order({
          id: "n1",
          supplierName: "สดร้าน",
          supplier: { isVatRegistered: false },
          attachments: [{ docType: null, source: "pr", purpose: "delivery_confirmation" }],
        }),
      ],
      NOW,
    );
    const vatGroup = view.groups.find((g) => g.supplier === "VAT ร้าน");
    const nonVatGroup = view.groups.find((g) => g.supplier === "สดร้าน");
    expect(vatGroup?.ask).toBe(DOC_CHASE_ASK_VAT);
    expect(nonVatGroup?.ask).toBe(DOC_CHASE_ASK_NON_VAT);
    const n1 = nonVatGroup?.rows[0];
    expect(n1?.hasSitePaper).toBe(false);
    expect(n1?.hasVendorDoc).toBe(false);
  });

  it("site-paper and vendor-doc flags read their own sides only", () => {
    const view = buildDocChaseView(
      [
        order({
          id: "s1",
          attachments: [{ docType: null, source: "pr", purpose: "invoice" }],
        }),
        order({
          id: "s2",
          supplierName: "ร้าน ค",
          supplier: { isVatRegistered: true },
          attachments: [{ docType: "receipt_cash_bill", source: "po", purpose: "source_document" }],
        }),
      ],
      NOW,
    );
    // s1 is covered_loose → not in groups at all
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(["s2"]);
    // s2: vendor uploaded a typed cash bill — wrong doc for a VAT vendor, so still
    // chased, but the vendor-doc side shows something arrived
    const s2 = view.groups[0]?.rows[0];
    expect(s2?.hasVendorDoc).toBe(true);
    expect(s2?.hasSitePaper).toBe(false);
  });

  it("assembles view rows straight through — PR docs + the linked PO's docs land on the order", () => {
    // Inputs are rows FROM the _current views (already current-state filtered
    // by the DB's own anti-join+null rule) — assemble adds no second filter.
    const orders = assembleDocChaseOrders({
      prs: [
        {
          id: "p1",
          pr_number: 260101,
          item_description: "x",
          status: "delivered",
          project_id: "prj",
          supplier_id: "s1",
          supplier: null,
          purchase_order_id: "po1",
          delivered_at: "2026-07-10T05:00:00+00:00",
          purchased_at: null,
          created_at: "2026-07-01T00:00:00+00:00",
        },
      ],
      prAttachments: [{ purchase_request_id: "p1", doc_type: null, purpose: "invoice" }],
      poAttachments: [
        { purchase_order_id: "po1", doc_type: "tax_invoice_full", purpose: "source_document" },
      ],
      waivedPrIds: new Set(),
      suppliers: new Map([["s1", { name: "ร้าน VAT", isVatRegistered: true }]]),
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.attachments).toEqual([
      { docType: null, source: "pr", purpose: "invoice" },
      { docType: "tax_invoice_full", source: "po", purpose: "source_document" },
    ]);
    const view = buildDocChaseView(orders, NOW);
    expect(view.summary.missing).toBe(0);
  });

  it("assemble resolves supplier name/flag and threads waivers + free-text suppliers", () => {
    const orders = assembleDocChaseOrders({
      prs: [
        {
          id: "p1",
          pr_number: null,
          item_description: "a",
          status: "delivered",
          project_id: null,
          supplier_id: null,
          supplier: "ร้านปากซอย",
          purchase_order_id: null,
          delivered_at: null,
          purchased_at: null,
          created_at: "2026-07-01T00:00:00+00:00",
        },
        {
          id: "p2",
          pr_number: 260102,
          item_description: "b",
          status: "delivered",
          project_id: "prj",
          supplier_id: "s9",
          supplier: null,
          purchase_order_id: null,
          delivered_at: null,
          purchased_at: null,
          created_at: "2026-07-01T00:00:00+00:00",
        },
      ],
      prAttachments: [],
      poAttachments: [],
      waivedPrIds: new Set(["p2"]),
      suppliers: new Map([["s9", { name: "หจก. เก้า", isVatRegistered: false }]]),
    });
    expect(orders[0]).toMatchObject({ supplierName: "ร้านปากซอย", supplier: null, waived: false });
    expect(orders[1]).toMatchObject({
      supplierName: "หจก. เก้า",
      supplier: { isVatRegistered: false },
      waived: true,
    });
  });

  it("counts missing per project for the hub cards (covered rows excluded, null = store rows)", () => {
    const m = countMissingByProject([
      order({ id: "x1", projectId: "A" }),
      order({ id: "x2", projectId: "A" }),
      order({
        id: "x3",
        projectId: "B",
        attachments: [{ docType: "tax_invoice_full", source: "po", purpose: "source_document" }],
      }),
      order({ id: "x4", projectId: null }),
    ]);
    expect(m.get("A")).toBe(2);
    expect(m.get("B")).toBeUndefined();
    expect(m.get(null)).toBe(1);
  });

  it("flags a juristic-name supplier classed non-vat for a VAT re-check", () => {
    const view = buildDocChaseView(
      [
        order({
          id: "j1",
          supplierName: "บริษัท ทดสอบ จำกัด",
          supplier: { isVatRegistered: false },
        }),
        order({ id: "j2", supplierName: "ร้านห้องแถว", supplier: { isVatRegistered: false } }),
      ],
      NOW,
    );
    expect(view.groups.find((g) => g.supplier === "บริษัท ทดสอบ จำกัด")?.misflagHint).toBe(true);
    expect(view.groups.find((g) => g.supplier === "ร้านห้องแถว")?.misflagHint).toBe(false);
  });
});
