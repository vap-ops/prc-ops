// Spec 168 — /contacts/dc (DC): the DC contact list, split off from the old
// merged crews page so it no longer shares a screen with ผู้รับเหมาช่วง. DC =
// contractors table rows with contractor_category='dc' (paid directly by PRC,
// daily). This is the DC *contact* record list — distinct from /workers (the DC
// worker roster + day rates). PM/super only; user session.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts/contacts-tabs";
import type { RecordRow } from "@/components/features/purchasing/record-manager";

export const metadata = { title: "ทีม DC" };

export default async function ContactsDcPage() {
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("contractors")
    .select(
      "id, name, phone, contractor_category, contractor_subtype, status, contact_person, email, mailing_address, tax_id, note",
    )
    .eq("contractor_category", "dc")
    .order("name", { ascending: true });

  const dc: RecordRow[] = (data ?? []).map((r) => ({
    id: r.id,
    values: {
      name: r.name,
      phone: r.phone,
      contractorSubtype: r.contractor_subtype,
      status: r.status,
      contactPerson: r.contact_person,
      email: r.email,
      mailingAddress: r.mailing_address,
      taxId: r.tax_id,
      note: r.note,
    },
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">ทีม DC</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs group="dc" dc={dc} />
      </div>
    </PageShell>
  );
}
