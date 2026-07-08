import { Receipt } from "lucide-react";
import { SelfPurchaseForm } from "@/components/features/purchasing/self-purchase-form";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import { CATALOG_LABEL, SITE_EXPENSE_HEADING } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";

// Spec 285 U3 — the self-purchase surface is an EXPENSE (จ่ายเงินไปแล้ว), split
// out of the "คำขอซื้อ" tab into its own "ค่าใช้จ่ายหน้างาน" tab. Distinct chrome —
// expense heading + a Receipt icon (vs the request's ShoppingCart) — so the money-
// already-spent expense never reads like a ขอซื้อ (ask-procurement) request. The
// form itself is catalog-only + amount-required (U1) and evidence-gated (U2).
// Server-safe wrapper (no 'use client') over the client form.
export function SelfPurchaseSection({
  projectId,
  workPackageId,
  catalogItems,
  categories,
}: {
  projectId: string;
  workPackageId: string;
  catalogItems: PurchaseRequestCatalogItem[];
  // Spec 221 cleanup: the managed main categories (ordered, id + name) threaded
  // to the shared catalog picker.
  categories: { id: string; name: string }[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-body text-ink flex items-center gap-1.5 font-semibold">
          <Receipt aria-hidden className="size-4 shrink-0" />
          {SITE_EXPENSE_HEADING}
        </h3>
        <p className="text-meta text-ink-secondary mt-0.5">
          จ่ายเงินไปแล้ว — เลือกจาก{CATALOG_LABEL} ระบุจำนวนเงิน แล้วแนบรูปสินค้าและใบเสร็จ
        </p>
      </div>
      <div className={CARD}>
        <SelfPurchaseForm
          projectId={projectId}
          workPackageId={workPackageId}
          catalogItems={catalogItems}
          categories={categories}
        />
      </div>
    </section>
  );
}
