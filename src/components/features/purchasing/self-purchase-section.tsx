import { SitePurchaseForm } from "@/components/features/purchasing/site-purchase-form";
import {
  SitePurchaseUseNow,
  type CatalogPick,
} from "@/components/features/store/site-purchase-use-now";
import { CARD } from "@/lib/ui/classes";

export type { CatalogPick };

// Spec 211 U11a — self-purchase, consolidated in one place (operator steer
// 2026-06-27: "PR is PR, self purchase is self purchase … consolidate in 1
// place"). The two self-purchase actions used to live in DIFFERENT WP tabs —
// บันทึกการซื้อหน้างาน (off-catalog, with a VAT invoice) in คำขอซื้อ, and
// ซื้อเงินสด ใช้ที่งานนี้เลย (catalogued, cash, buy + เบิก) in เบิกของ. This groups
// both under one ซื้อเอง heading so "I paid for it myself on site" is one place;
// the ask-procurement PR form (สร้างคำขอซื้อ) stays its own affordance above.
// Server-safe wrapper (no 'use client') over the two client forms.
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
          จ่ายเงินเองหน้างาน — เลือก &quot;บันทึกการซื้อหน้างาน&quot;
          เมื่อมีใบกำกับภาษี/นอกแคตตาล็อก หรือ &quot;ซื้อเงินสด ใช้ที่งานนี้เลย&quot;
          สำหรับของในคลังที่จ่ายสดและใช้ทันที
        </p>
      </div>
      {/* #2 — off-catalog record + receipt/invoice (docs) image. */}
      <details className={CARD}>
        <summary className="text-body text-ink cursor-pointer font-semibold">
          บันทึกการซื้อหน้างาน
        </summary>
        <div className="mt-3">
          <SitePurchaseForm workPackageId={workPackageId} projectId={projectId} />
        </div>
      </details>
      {/* #3 — catalogued cash buy that receives into the store + เบิก in one tap. */}
      <div className={CARD}>
        <SitePurchaseUseNow
          projectId={projectId}
          workPackageId={workPackageId}
          catalogItems={catalogItems}
        />
      </div>
    </section>
  );
}
