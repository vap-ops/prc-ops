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
};

// Price evidence (quote) is confidential to procurement; everything else is part
// of the purchase audit trail accounting may see.
export function isAuditableAttachmentPurpose(purpose: string): boolean {
  return purpose !== "quote";
}

export function attachmentPurposeLabel(purpose: string): string {
  return PURPOSE_LABEL[purpose] ?? purpose;
}
