// Spec 66 §App — pure validation for the on-site purchase form. The
// record_site_purchase RPC re-checks everything server-side (role gate +
// input re-checks); this layer exists for fast, friendly Thai errors.
// Caps match the existing purchasing length floors (spec 36): item 500,
// unit 40.

import { UUID_REGEX } from "@/lib/validate/uuid";

const ITEM_MAX = 500;
const UNIT_MAX = 40;

export interface ValidatedSitePurchase {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
}

export type ValidateSitePurchaseResult =
  | { ok: true; value: ValidatedSitePurchase }
  | { ok: false; error: string };

export function validateSitePurchase(input: {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
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
  return {
    ok: true,
    value: { workPackageId: input.workPackageId, itemDescription, quantity: input.quantity, unit },
  };
}
