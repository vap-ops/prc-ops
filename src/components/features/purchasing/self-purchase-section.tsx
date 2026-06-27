import {
  SelfPurchaseForm,
  type CatalogPick,
} from "@/components/features/purchasing/self-purchase-form";
import { CATALOG_LABEL } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";

export type { CatalogPick };

// Spec 211 U11a→U11c-B — self-purchase, ONE guided ซื้อเอง form. U11a first put
// the two self-purchase actions in one place; U11c unified them into a single
// form: item (catalog OR free-text), จำนวนเงิน, มีใบกำกับภาษี? (Input VAT split),
// and — catalog items only — ซื้อใช้ที่งานนี้เลย (receive into store + เบิก, the
// VAT-aware site_purchase_use_now). Free-text routes to the record path
// (books the WP). The ask-procurement PR form (สร้างคำขอซื้อ) stays its own
// affordance above. Server-safe wrapper (no 'use client') over the client form.
export function SelfPurchaseSection({
  projectId,
  workPackageId,
  catalogItems,
}: {
  projectId: string;
  workPackageId: string;
  catalogItems: CatalogPick[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-body text-ink font-semibold">ซื้อเอง</h3>
        <p className="text-meta text-ink-secondary mt-0.5">
          จ่ายเงินเองหน้างาน — เลือกจาก{CATALOG_LABEL}หรือพิมพ์เอง ระบุว่ามีใบกำกับภาษีไหม
          และจะใช้ที่งานนี้เลยหรือเก็บไว้เป็นบันทึก
        </p>
      </div>
      <div className={CARD}>
        <SelfPurchaseForm
          projectId={projectId}
          workPackageId={workPackageId}
          catalogItems={catalogItems}
        />
      </div>
    </section>
  );
}
