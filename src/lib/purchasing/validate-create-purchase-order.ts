// Spec 116 / ADR 0044 — pure validation for the create-PO form. The
// create_purchase_order RPC re-checks everything server-side (approved-only
// lines, supplier exists, positive amounts, atomic); this layer exists for fast,
// friendly errors before the round-trip.

import { ISO_DATE_REGEX } from "@/lib/dates";
import { UUID_REGEX } from "@/lib/validate/uuid";

export interface CreatePurchaseOrderLine {
  requestId: string;
  amount: number | null;
}

export interface ValidatedCreatePurchaseOrder {
  supplierId: string;
  // Required on a PO: cutting an order to a supplier commits a delivery date.
  // (Ad-hoc record_purchase keeps ETA optional.) Optional-PO-ETA is a recorded
  // seam — it needs the RPC's p_eta to gain a SQL default first.
  eta: string;
  lines: CreatePurchaseOrderLine[];
}

export type ValidateCreatePurchaseOrderResult =
  | { ok: true; value: ValidatedCreatePurchaseOrder }
  | { ok: false; error: string };

export function validateCreatePurchaseOrder(input: {
  supplierId: string;
  eta: string | null;
  lines: CreatePurchaseOrderLine[];
}): ValidateCreatePurchaseOrderResult {
  if (!UUID_REGEX.test(input.supplierId)) {
    return { ok: false, error: "กรุณาเลือกผู้ขาย" };
  }
  if (input.lines.length === 0) {
    return { ok: false, error: "กรุณาเลือกอย่างน้อยหนึ่งรายการ" };
  }

  const seen = new Set<string>();
  for (const line of input.lines) {
    if (!UUID_REGEX.test(line.requestId)) {
      return { ok: false, error: "รหัสคำขอไม่ถูกต้อง" };
    }
    if (seen.has(line.requestId)) {
      return { ok: false, error: "มีรายการซ้ำในใบสั่งซื้อ" };
    }
    seen.add(line.requestId);
    if (line.amount !== null && (!Number.isFinite(line.amount) || line.amount <= 0)) {
      return { ok: false, error: "จำนวนเงินต้องเป็นตัวเลขมากกว่าศูนย์" };
    }
  }

  const eta = (input.eta ?? "").trim();
  if (eta === "") {
    return { ok: false, error: "กรุณาระบุวันที่คาดว่าจะได้รับของ" };
  }
  if (!ISO_DATE_REGEX.test(eta)) {
    return { ok: false, error: "วันที่คาดว่าจะได้รับของไม่ถูกต้อง" };
  }

  return {
    ok: true,
    value: {
      supplierId: input.supplierId,
      eta,
      lines: input.lines.map((l) => ({ requestId: l.requestId, amount: l.amount })),
    },
  };
}
