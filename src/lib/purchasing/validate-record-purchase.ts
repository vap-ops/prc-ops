// Spec 33 §2 — pure validation for the in-app purchase-recording form.
// The record_purchase RPC re-checks everything server-side (two-layer
// guard, decide-pattern); this layer exists for fast, friendly errors.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_REF_MAX = 80;

export interface ValidatedRecordPurchase {
  requestId: string;
  supplierId: string;
  orderRef: string | null;
  amount: number | null;
  eta: string | null;
}

export type ValidateRecordPurchaseResult =
  | { ok: true; value: ValidatedRecordPurchase }
  | { ok: false; error: string };

export function validateRecordPurchase(input: {
  requestId: string;
  supplierId: string;
  orderRef: string;
  amount: number | null;
  eta: string | null;
}): ValidateRecordPurchaseResult {
  if (!UUID_REGEX.test(input.requestId)) {
    return { ok: false, error: "รหัสคำขอไม่ถูกต้อง" };
  }
  if (!UUID_REGEX.test(input.supplierId)) {
    return { ok: false, error: "กรุณาเลือกผู้ขาย" };
  }
  const orderRef = input.orderRef.trim();
  if (orderRef.length > ORDER_REF_MAX) {
    return { ok: false, error: `เลขที่ใบสั่งซื้อต้องไม่เกิน ${ORDER_REF_MAX} ตัวอักษร` };
  }
  if (input.amount !== null && (!Number.isFinite(input.amount) || input.amount <= 0)) {
    return { ok: false, error: "จำนวนเงินต้องเป็นตัวเลขมากกว่าศูนย์" };
  }
  if (input.eta !== null && input.eta !== "" && !ETA_REGEX.test(input.eta)) {
    return { ok: false, error: "วันที่คาดว่าจะได้รับของไม่ถูกต้อง" };
  }
  return {
    ok: true,
    value: {
      requestId: input.requestId,
      supplierId: input.supplierId,
      orderRef: orderRef.length === 0 ? null : orderRef,
      amount: input.amount,
      eta: input.eta === "" || input.eta === null ? null : input.eta,
    },
  };
}
