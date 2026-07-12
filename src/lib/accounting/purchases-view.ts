// Spec 196 Tier 3 — pure layer for the accounting purchase register + voucher.
// Status labels, a register summary (gross/VAT/net derived per PR from its gross
// + vat_rate, satang-summed), and the attachment-purpose policy: accounting may
// vouch reference/invoice/delivery/payment evidence, but NOT 'quote' — price
// comparison stays procurement-only (the operator's call for spec 196).

import { deriveVatBreakdown } from "@/lib/purchasing/vat";

export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  requested: "รอจัดซื้อ",
  approved: "อนุมัติแล้ว",
  purchased: "จัดซื้อแล้ว",
  site_purchased: "ซื้อหน้างาน",
  on_route: "กำลังจัดส่ง",
  delivered: "รับของแล้ว",
  rejected: "ปฏิเสธ",
  cancelled: "ยกเลิก",
};

export function purchaseStatusLabel(status: string): string {
  return PURCHASE_STATUS_LABEL[status] ?? status;
}

export interface PurchaseAmount {
  gross: number;
  vatRate: number;
}

export interface PurchasesSummary {
  count: number;
  totalGross: number;
  totalVat: number;
  totalNet: number;
}

// Spec 211 U9 (accounting-ap-02): each register row is a purchase request (one
// ใบขอซื้อ, drilling into its voucher), not a generic รายการ — `รายการ` is
// reserved for genuine line-items (the U3 de-overload, carried into accounting).
export function purchaseRegisterCountLabel(count: number): string {
  return `${count} ใบขอซื้อ`;
}

export interface RegisterPoGroup<T> {
  // The PO this group belongs to; null = the direct/site purchases (no PO).
  poNumber: number | null;
  rows: T[];
  subtotalGross: number;
}

// Spec 211 (accounting-ap-03): group the register by purchase order so an auditor
// reads a PO's purchases together with a subtotal. PO groups keep first-appearance
// order (the rows arrive purchased_at-desc); the no-PO group (direct/site buys)
// sorts last. Subtotal is satang-summed (mirrors summarizePurchases).
export function groupRegisterByPo<T extends { gross: number; poNumber: number | null }>(
  rows: ReadonlyArray<T>,
): RegisterPoGroup<T>[] {
  const byPo = new Map<number, T[]>();
  const order: number[] = [];
  const noPo: T[] = [];
  for (const r of rows) {
    if (r.poNumber === null) {
      noPo.push(r);
      continue;
    }
    let group = byPo.get(r.poNumber);
    if (!group) {
      group = [];
      byPo.set(r.poNumber, group);
      order.push(r.poNumber);
    }
    group.push(r);
  }
  const subtotal = (g: ReadonlyArray<T>): number =>
    g.reduce((sat, r) => sat + Math.round(r.gross * 100), 0) / 100;
  const groups: RegisterPoGroup<T>[] = order.map((po) => {
    const g = byPo.get(po) ?? [];
    return { poNumber: po, rows: g, subtotalGross: subtotal(g) };
  });
  if (noPo.length > 0) {
    groups.push({ poNumber: null, rows: noPo, subtotalGross: subtotal(noPo) });
  }
  return groups;
}

export function summarizePurchases(rows: PurchaseAmount[]): PurchasesSummary {
  let grossSatang = 0;
  let vatSatang = 0;
  let netSatang = 0;
  for (const r of rows) {
    const { net, vat, gross } = deriveVatBreakdown(r.gross, r.vatRate);
    grossSatang += Math.round(gross * 100);
    vatSatang += Math.round(vat * 100);
    netSatang += Math.round(net * 100);
  }
  return {
    count: rows.length,
    totalGross: grossSatang / 100,
    totalVat: vatSatang / 100,
    totalNet: netSatang / 100,
  };
}

const PURPOSE_LABEL: Record<string, string> = {
  reference: "เอกสารอ้างอิง",
  invoice: "ใบแจ้งหนี้/ใบกำกับภาษี",
  delivery_confirmation: "หลักฐานการรับของ",
  payment: "หลักฐานการชำระเงิน",
  quote: "ใบเสนอราคา",
  // Spec 308 follow-up: the delivery-scoped receive paper (ใบส่งของ/ใบเสร็จ) +
  // truck proof captured on the ของเข้า receive page — a purchase_order_attachments
  // purpose, surfaced on the voucher for delivery-backed PRs.
  proof_of_delivery: "เอกสารส่งของ / หลักฐานการรับของ",
};

// Price evidence (quote) is confidential to procurement; everything else is part
// of the purchase audit trail accounting may see.
export function isAuditableAttachmentPurpose(purpose: string): boolean {
  return purpose !== "quote";
}

export function attachmentPurposeLabel(purpose: string): string {
  return PURPOSE_LABEL[purpose] ?? purpose;
}
