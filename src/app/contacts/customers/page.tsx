// Spec 99 — /contacts/customers (ลูกค้า). One of the three contact groups split
// out of the old packed /contacts (spec 87). PM/super only; no money column read
// here (bank lives in contact_bank, admin-only), so reads use the user session.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts/contacts-tabs";
import type { RecordRow } from "@/components/features/purchasing/record-manager";

export const metadata = { title: "ลูกค้า" };

export default async function ContactsCustomersPage() {
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("clients")
    .select("id, name, contact_person, phone, email, mailing_address, note")
    .order("name", { ascending: true });

  const clients: RecordRow[] = (data ?? []).map((r) => ({
    id: r.id,
    values: {
      name: r.name,
      contactPerson: r.contact_person,
      phone: r.phone,
      email: r.email,
      mailingAddress: r.mailing_address,
      note: r.note,
    },
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">ลูกค้า</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs group="customers" clients={clients} />
      </div>
    </PageShell>
  );
}
