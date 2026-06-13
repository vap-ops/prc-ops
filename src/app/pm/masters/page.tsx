// Spec 81 — /pm/masters: manage the three reference masters (clients,
// suppliers, contractors). PM/super only; no money column on any master, so
// reads use the ordinary user-session client (contrast /workers, which needs
// the admin client for day_rate).

import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { MastersTabs } from "@/components/features/masters-tabs";
import type { MasterRow } from "@/components/features/master-manager";

export const metadata = { title: "ข้อมูลหลัก" };

export default async function MastersPage() {
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

  const clients: MasterRow[] = (clientsRes.data ?? []).map((r) => ({
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
  const suppliers: MasterRow[] = (suppliersRes.data ?? []).map((r) => ({
    id: r.id,
    values: { name: r.name, phone: r.phone, note: r.note },
  }));
  const contractors: MasterRow[] = (contractorsRes.data ?? []).map((r) => ({
    id: r.id,
    values: { name: r.name, phone: r.phone, note: r.note },
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader
        kicker="ข้อมูลหลัก"
        title="ลูกค้า ผู้ขาย ผู้รับเหมา"
        fullName={ctx.fullName}
        maxWidthClass={PAGE_MAX_W}
      />
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <MastersTabs clients={clients} suppliers={suppliers} contractors={contractors} />
      </div>
    </PageShell>
  );
}
