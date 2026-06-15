// Spec 99 — /contacts/vendors (ผู้ขาย + ผู้ให้บริการ): the vendors-you-pay group.
// PM/super only; no money column read here (bank is admin-only), user session.

import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/detail-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts-tabs";
import type { RecordRow } from "@/components/features/record-manager";

export const metadata = { title: "ผู้ขายและผู้ให้บริการ" };

export default async function ContactsVendorsPage() {
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createServerSupabase();

  const [suppliersRes, serviceRes] = await Promise.all([
    supabase
      .from("suppliers")
      .select(
        "id, name, phone, contact_person, email, mailing_address, tax_id, payment_terms, note",
      )
      .order("name", { ascending: true }),
    supabase
      .from("service_providers")
      .select(
        "id, name, phone, service_subtype, status, contact_person, email, mailing_address, vehicle_type, plate_no, note",
      )
      .order("name", { ascending: true }),
  ]);

  const suppliers: RecordRow[] = (suppliersRes.data ?? []).map((r) => ({
    id: r.id,
    values: {
      name: r.name,
      phone: r.phone,
      contactPerson: r.contact_person,
      email: r.email,
      mailingAddress: r.mailing_address,
      taxId: r.tax_id,
      paymentTerms: r.payment_terms,
      note: r.note,
    },
  }));

  const serviceProviders: RecordRow[] = (serviceRes.data ?? []).map((r) => ({
    id: r.id,
    values: {
      name: r.name,
      phone: r.phone,
      serviceSubtype: r.service_subtype,
      status: r.status,
      contactPerson: r.contact_person,
      email: r.email,
      mailingAddress: r.mailing_address,
      vehicleType: r.vehicle_type,
      plateNo: r.plate_no,
      note: r.note,
    },
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">ผู้ขายและผู้ให้บริการ</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs group="vendors" suppliers={suppliers} serviceProviders={serviceProviders} />
      </div>
    </PageShell>
  );
}
