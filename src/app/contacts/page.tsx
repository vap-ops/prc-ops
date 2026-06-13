// Spec 81 — /contacts: manage the three contact tables (clients,
// suppliers, contractors). PM/super only; no money column on any of them, so
// reads use the ordinary user-session client (contrast /workers, which needs
// the admin client for day_rate).

import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts-tabs";
import type { RecordRow } from "@/components/features/record-manager";

export const metadata = { title: "รายชื่อติดต่อ" };

export default async function ContactsPage() {
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createServerSupabase();

  const [clientsRes, suppliersRes, contractorsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, contact_person, phone, email, mailing_address, note")
      .order("name", { ascending: true }),
    supabase.from("suppliers").select("id, name, phone, note").order("name", { ascending: true }),
    supabase.from("contractors").select("id, name, phone, note").order("name", { ascending: true }),
  ]);

  const clients: RecordRow[] = (clientsRes.data ?? []).map((r) => ({
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
  const suppliers: RecordRow[] = (suppliersRes.data ?? []).map((r) => ({
    id: r.id,
    values: { name: r.name, phone: r.phone, note: r.note },
  }));
  const contractors: RecordRow[] = (contractorsRes.data ?? []).map((r) => ({
    id: r.id,
    values: { name: r.name, phone: r.phone, note: r.note },
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader
        kicker="รายชื่อติดต่อ"
        title="รายชื่อผู้ติดต่อ"
        fullName={ctx.fullName}
        maxWidthClass={PAGE_MAX_W}
      />
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs clients={clients} suppliers={suppliers} contractors={contractors} />
      </div>
    </PageShell>
  );
}
