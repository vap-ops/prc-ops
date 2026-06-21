// Spec 168 — /contacts/subcontractors (ผู้รับเหมาช่วง): the subcontractor list,
// split off from the old merged crews page so it no longer shares a screen with
// DC. ผู้รับเหมาช่วง = contractors table rows with contractor_category='contractor'
// (a firm PRC hires that pays its OWN crew). PM/super only; user session.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts/contacts-tabs";
import type { RecordRow } from "@/components/features/purchasing/record-manager";
import { SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: SUBCONTRACTOR_LABEL };

export default async function ContactsSubcontractorsPage() {
  // Spec 172 Phase B: procurement curates subcontractors (back-office master data,
  // like suppliers) — admitted alongside pm/super/director.
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("contractors")
    .select(
      "id, name, phone, contractor_category, status, contact_person, email, mailing_address, tax_id, specialty, note",
    )
    .eq("contractor_category", "contractor")
    .order("name", { ascending: true });

  const contractors: RecordRow[] = (data ?? []).map((r) => ({
    id: r.id,
    values: {
      name: r.name,
      phone: r.phone,
      status: r.status,
      contactPerson: r.contact_person,
      email: r.email,
      mailingAddress: r.mailing_address,
      taxId: r.tax_id,
      specialty: r.specialty,
      note: r.note,
    },
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{SUBCONTRACTOR_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs group="subcontractors" contractors={contractors} />
      </div>
    </PageShell>
  );
}
