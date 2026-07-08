// Spec 66 §App — pure validation for the on-site purchase form. The
// record_site_purchase RPC re-checks everything server-side (role gate +
// input re-checks); this layer exists for fast, friendly Thai errors.
// Caps match the existing purchasing length floors (spec 36): item 500,
// unit 40.

import { UUID_REGEX } from "@/lib/validate/uuid";
import { isPurchaseReasonCode, type PurchaseReasonCode } from "@/lib/purchasing/reason-code";

const ITEM_MAX = 500;
const UNIT_MAX = 40;

export interface ValidatedSitePurchase {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  // Spec 285 U1: required purchase amount (THB) — an expense must have a cost.
  amount: number;
  // Spec 176 U4: the reactive-reason tag — required, no default.
  reasonCode: PurchaseReasonCode;
  // Spec 211 U11c-B: VAT rate (%) of a tax-invoiced buy; 0 = cash / no invoice.
  // record_site_purchase splits the reclaimable Input VAT (1300) when > 0.
  vatRate: number;
}

export type ValidateSitePurchaseResult =
  | { ok: true; value: ValidatedSitePurchase }
  | { ok: false; error: string };

export function validateSitePurchase(input: {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  amount: number | null;
  reasonCode?: string | null | undefined;
  vatRate?: number | null | undefined;
}): ValidateSitePurchaseResult {
  if (!UUID_REGEX.test(input.workPackageId)) {
    return { ok: false, error: "รหัสงานไม่ถูกต้อง" };
  }
  const itemDescription = input.itemDescription.trim();
  if (itemDescription.length === 0) {
    return { ok: false, error: "กรุณาระบุรายการที่ซื้อ" };
  }
  if (itemDescription.length > ITEM_MAX) {
    return { ok: false, error: `รายการที่ซื้อต้องไม่เกิน ${ITEM_MAX} ตัวอักษร` };
  }
  const unit = input.unit.trim();
  if (unit.length === 0) {
    return { ok: false, error: "กรุณาระบุหน่วย" };
  }
  if (unit.length > UNIT_MAX) {
    return { ok: false, error: `หน่วยต้องไม่เกิน ${UNIT_MAX} ตัวอักษร` };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: "จำนวนต้องเป็นตัวเลขมากกว่าศูนย์" };
  }
  // Spec 285 U1: amount is REQUIRED — a site expense must carry a cost (this
  // is what blocks the ขอซื้อ-meant-as-ซื้อเอง misfire: a would-be requester has
  // no amount yet, so an expense won't save and they are pushed to the request).
  if (input.amount === null || !Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "กรุณาระบุจำนวนเงินที่จ่าย" };
  }
  // Spec 176 U4: required reactive-reason tag — the on-site path is reactive too.
  if (!isPurchaseReasonCode(input.reasonCode)) {
    return { ok: false, error: "กรุณาเลือกเหตุผลของการซื้อ" };
  }
  // Spec 211 U11c-B: VAT rate (%) — 0 when absent (cash / no invoice).
  const vatRate = input.vatRate ?? 0;
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return { ok: false, error: "อัตราภาษีต้องอยู่ระหว่าง 0–100" };
  }
  return {
    ok: true,
    value: {
      workPackageId: input.workPackageId,
      itemDescription,
      quantity: input.quantity,
      unit,
      amount: input.amount,
      reasonCode: input.reasonCode,
      vatRate,
    },
  };
}
