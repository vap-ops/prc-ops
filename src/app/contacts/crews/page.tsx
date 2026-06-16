// Spec 99 — /contacts/crews (ผู้รับเหมา + DC): the labor-crew group. ผู้รับเหมา
// and DC are the ONE contractors table split by contractor_category. PM/super
// only; no money column read here, user session.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts/contacts-tabs";
import type { RecordRow } from "@/components/features/purchasing/record-manager";

export const metadata = { title: "ผู้รับเหมาและทีม DC" };

export default async function ContactsCrewsPage() {
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("contractors")
    .select(
      "id, name, phone, contractor_category, contractor_subtype, status, contact_person, email, mailing_address, tax_id, specialty, note",
    )
    .order("name", { ascending: true });

  const toRow = (r: {
    id: string;
    name: string;
    phone: string | null;
    contractor_subtype: string | null;
    status: string;
    contact_person: string | null;
    email: string | null;
    mailing_address: string | null;
    tax_id: string | null;
    specialty: string | null;
    note: string | null;
  }): RecordRow => ({
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
      specialty: r.specialty,
      note: r.note,
    },
  });

  const all = data ?? [];
  const contractors: RecordRow[] = all
    .filter((r) => r.contractor_category === "contractor")
    .map(toRow);
  const dc: RecordRow[] = all.filter((r) => r.contractor_category === "dc").map(toRow);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">ผู้รับเหมาและทีม DC</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs group="crews" contractors={contractors} dc={dc} />
      </div>
    </PageShell>
  );
}
