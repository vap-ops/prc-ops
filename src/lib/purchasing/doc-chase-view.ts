// Spec 380 U3 — chase-page view model: raw order rows → supplier groups.
// Pure so the grouping/sorting/summary logic tests without RSC rendering;
// the page is a thin IO shell over this (spec §4 U3).

import { DOC_CHASE_NO_SUPPLIER_LABEL } from "@/lib/i18n/labels";
import {
  agingDays,
  chaseAsk,
  docCoverage,
  docRequirementClass,
  type DocAttachment,
  type DocCoverage,
  type PurchaseRequestStatus,
} from "@/lib/purchasing/doc-chase";

export interface DocChaseOrderInput {
  id: string;
  prNumber: number | null;
  itemDescription: string;
  /** Resolved display name: suppliers.name ?? pr.supplier ?? null. */
  supplierName: string | null;
  /** null = no suppliers row (class unknown). */
  supplier: { isVatRegistered: boolean } | null;
  status: PurchaseRequestStatus;
  attachments: readonly DocAttachment[];
  waived: boolean;
  deliveredAt: string | null;
  purchasedAt: string | null;
  createdAt: string;
  /** For the per-project dashboard card line; null = store-bound row. */
  projectId?: string | null;
}

export interface DocChaseRow {
  id: string;
  prNumber: number | null;
  itemDescription: string;
  agingDays: number;
  coverage: DocCoverage;
  /** Site's paper photo side (PR invoice/payment — typed or loose). */
  hasSitePaper: boolean;
  /** Vendor/procurement side (PO attachments — anything present). */
  hasVendorDoc: boolean;
}

export interface DocChaseGroup {
  supplier: string;
  ask: string;
  misflagHint: boolean;
  count: number;
  oldestDays: number;
  rows: DocChaseRow[];
}

export interface DocChaseView {
  summary: { missing: number; over14: number; suppliers: number; waived: number };
  groups: DocChaseGroup[];
  waived: DocChaseRow[];
}

export interface DocChaseSourceRows {
  prs: ReadonlyArray<{
    id: string;
    pr_number: number | null;
    item_description: string;
    status: string;
    project_id: string | null;
    supplier_id: string | null;
    supplier: string | null;
    purchase_order_id: string | null;
    delivered_at: string | null;
    purchased_at: string | null;
    created_at: string;
  }>;
  /**
   * Rows FROM the `_current` views only (superseded_by null AND not pointed-at
   * — the tables' own current-state definition, which a hand-rolled filter
   * here would inevitably re-derive wrong; live-proven in spec 345 U3).
   */
  prAttachments: ReadonlyArray<{
    purchase_request_id: string;
    doc_type: PurchaseDocTypeOrNull;
    purpose: string;
  }>;
  poAttachments: ReadonlyArray<{
    purchase_order_id: string;
    doc_type: PurchaseDocTypeOrNull;
    purpose: string;
  }>;
  waivedPrIds: ReadonlySet<string>;
  suppliers: ReadonlyMap<string, { name: string | null; isVatRegistered: boolean }>;
}

type PurchaseDocTypeOrNull = DocAttachment["docType"];

/** View rows → view-model inputs. Pure; the server loader stays IO-only. */
export function assembleDocChaseOrders(src: DocChaseSourceRows): DocChaseOrderInput[] {
  const prAttsByPr = new Map<string, DocAttachment[]>();
  for (const a of src.prAttachments) {
    const list = prAttsByPr.get(a.purchase_request_id) ?? [];
    list.push({ docType: a.doc_type, source: "pr", purpose: a.purpose });
    prAttsByPr.set(a.purchase_request_id, list);
  }
  const poAttsByPo = new Map<string, DocAttachment[]>();
  for (const a of src.poAttachments) {
    const list = poAttsByPo.get(a.purchase_order_id) ?? [];
    list.push({ docType: a.doc_type, source: "po", purpose: a.purpose });
    poAttsByPo.set(a.purchase_order_id, list);
  }

  return src.prs.map((pr) => {
    const supplierRow = pr.supplier_id ? (src.suppliers.get(pr.supplier_id) ?? null) : null;
    return {
      id: pr.id,
      prNumber: pr.pr_number,
      itemDescription: pr.item_description,
      supplierName: supplierRow?.name ?? pr.supplier,
      supplier: supplierRow ? { isVatRegistered: supplierRow.isVatRegistered } : null,
      status: pr.status as DocChaseOrderInput["status"],
      attachments: [
        ...(prAttsByPr.get(pr.id) ?? []),
        ...(pr.purchase_order_id ? (poAttsByPo.get(pr.purchase_order_id) ?? []) : []),
      ],
      waived: src.waivedPrIds.has(pr.id),
      deliveredAt: pr.delivered_at,
      purchasedAt: pr.purchased_at,
      createdAt: pr.created_at,
      projectId: pr.project_id,
    };
  });
}

/** Missing-doc count per project (null key = store-bound rows) for the hub cards. */
export function countMissingByProject(
  orders: readonly DocChaseOrderInput[],
): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const o of orders) {
    const cls = docRequirementClass(o.supplier);
    const cov = docCoverage({
      status: o.status,
      cls,
      attachments: o.attachments,
      waived: o.waived,
    });
    if (cov !== "missing") continue;
    const key = o.projectId ?? null;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

// Juristic-entity markers: a supplier named like a company but classed non-VAT
// deserves a flag re-check (spec §2 amendment — the DEFAULT-false blindness).
const JURISTIC_NAME = /บริษัท|บมจ|หจก|ห้างหุ้นส่วน/;

const SITE_PAPER_PURPOSES = new Set(["invoice", "payment"]);

function toRow(o: DocChaseOrderInput, nowMs: number, coverage: DocCoverage): DocChaseRow {
  return {
    id: o.id,
    prNumber: o.prNumber,
    itemDescription: o.itemDescription,
    agingDays: agingDays(nowMs, o.deliveredAt, o.purchasedAt, o.createdAt),
    coverage,
    hasSitePaper: o.attachments.some(
      (a) => a.source === "pr" && SITE_PAPER_PURPOSES.has(a.purpose),
    ),
    hasVendorDoc: o.attachments.some((a) => a.source === "po"),
  };
}

export function buildDocChaseView(
  orders: readonly DocChaseOrderInput[],
  nowMs: number,
): DocChaseView {
  const groups = new Map<string, { input: DocChaseOrderInput; row: DocChaseRow }[]>();
  const waived: DocChaseRow[] = [];

  for (const o of orders) {
    const cls = docRequirementClass(o.supplier);
    const coverage = docCoverage({
      status: o.status,
      cls,
      attachments: o.attachments,
      waived: o.waived,
    });
    if (coverage === "waived") {
      waived.push(toRow(o, nowMs, coverage));
      continue;
    }
    if (coverage !== "missing") continue;
    const key = o.supplierName ?? DOC_CHASE_NO_SUPPLIER_LABEL;
    const bucket = groups.get(key) ?? [];
    bucket.push({ input: o, row: toRow(o, nowMs, coverage) });
    groups.set(key, bucket);
  }

  const builtGroups: DocChaseGroup[] = [...groups.entries()].map(([supplier, entries]) => {
    const first = entries[0]!.input;
    const cls = docRequirementClass(first.supplier);
    const rows = entries.map((e) => e.row).sort((a, b) => b.agingDays - a.agingDays);
    return {
      supplier,
      ask: chaseAsk(cls),
      misflagHint: cls === "non_vat" && JURISTIC_NAME.test(supplier),
      count: rows.length,
      oldestDays: rows[0]?.agingDays ?? 0,
      rows,
    };
  });

  builtGroups.sort((a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier, "th"));

  const missingRows = builtGroups.flatMap((g) => g.rows);
  return {
    summary: {
      missing: missingRows.length,
      over14: missingRows.filter((r) => r.agingDays > 14).length,
      suppliers: builtGroups.length,
      waived: waived.length,
    },
    groups: builtGroups,
    waived,
  };
}
