// Spec 237 (ADR 0066 / S10-U2) — /catalog/boq-templates/[templateId]: one BOQ
// template's detail. Loads the template + its lines + the picker data the line
// form needs (the full catalog, categories, units, the global work-category
// library). A template the caller cannot see (or that doesn't exist) → notFound.
// Gated to BACK_OFFICE_ROLES.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { BOQ_TEMPLATES_LABEL } from "@/lib/i18n/labels";
import { loadBoqTemplateDetail, loadBoqPickerData } from "@/lib/boq/load";
import { BoqTemplateDetail } from "@/components/features/boq/boq-template-detail";

export const metadata = { title: BOQ_TEMPLATES_LABEL };

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default async function BoqTemplateDetailPage({ params }: PageProps) {
  const { templateId } = await params;
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const detail = await loadBoqTemplateDetail(supabase, templateId);
  if (!detail) notFound();

  const picker = await loadBoqPickerData(supabase);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/catalog/boq-templates" backLabel={BOQ_TEMPLATES_LABEL}>
        <h1 className="text-title text-ink font-bold tracking-tight">{detail.template.name}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <BoqTemplateDetail
          template={detail.template}
          lines={detail.lines}
          items={picker.items}
          categories={picker.categories}
          units={picker.units}
          workCategories={picker.workCategories}
        />
      </div>
    </PageShell>
  );
}
