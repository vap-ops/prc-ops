// Spec 331 §5 — the document-type registry editor. super_admin ONLY: this is the
// operator's anti-redundancy control point. Accounting picks from this list on
// /settings/company-docs and can never add to it, so three spellings of "ภ.พ.20"
// can't become three cards.
//
// Shows deactivated rows too (the picker hides them) — deactivating is how a type
// retires without deleting the documents already filed under it.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { DocTypeRegistryView } from "@/components/features/company-docs/doc-type-registry-view";
import { requireRole } from "@/lib/auth/require-role";
import { listFullRegistry } from "@/lib/company-docs/registry-actions";
import { COMPANY_DOC_TYPES_HINT, COMPANY_DOC_TYPES_LABEL } from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: "ตั้งค่าประเภทเอกสาร" };

export default async function CompanyDocTypesPage() {
  await requireRole(["super_admin"]);
  const { categories, types } = await listFullRegistry();

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{COMPANY_DOC_TYPES_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">{COMPANY_DOC_TYPES_HINT}</p>
        <DocTypeRegistryView categories={categories} types={types} />
      </section>
    </PageShell>
  );
}
