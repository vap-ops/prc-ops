"use client";

// Spec 120 — single-ticket purchase = a one-line PO. Replaces the old per-ticket
// record_purchase form on an approved request: one tap opens the create-PO sheet
// pre-seeded with just this ticket (no grid hunting). Same sheet as the bundle
// flow, so supplier / VAT / ETA / price / order_ref all come along.
//
// 'use client': the sheet open-state. Props are serializable (line + suppliers) —
// a server page can render it directly.

import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { BUTTON_PRIMARY } from "@/lib/ui/classes";
import {
  CreatePurchaseOrderSheet,
  type CreatePoLine,
} from "@/components/features/purchasing/create-purchase-order-sheet";
import type { SupplierOption } from "@/components/features/purchasing/purchase-record-form";

export function CreatePoFromRequestButton({
  line,
  suppliers,
}: {
  line: CreatePoLine;
  suppliers: SupplierOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${BUTTON_PRIMARY} w-full`}>
        <ShoppingCart aria-hidden className="mr-1.5 size-4" />
        สร้างใบสั่งซื้อ (PO)
      </button>
      <CreatePurchaseOrderSheet
        open={open}
        lines={[line]}
        suppliers={suppliers}
        onClose={() => setOpen(false)}
        onCreated={() => setOpen(false)}
      />
    </>
  );
}
