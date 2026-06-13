// Spec 81/87 — /contacts: manage the contact tables (clients, suppliers,
// contractors split into ผู้รับเหมา/DC by category, service providers). PM/super
// only; no money column is read here (bank lives in contact_bank, admin-only), so
// reads use the ordinary user-session client.

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

  const [clientsRes, suppliersRes, contractorsRes, serviceRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, contact_person, phone, email, mailing_address, note")
      .order("name", { ascending: true }),
    supabase
      .from("suppliers")
      .select(
        "id, name, phone, contact_person, email, mailing_address, tax_id, payment_terms, note",
      )
      .order("name", { ascending: true }),
    supabase
      .from("contractors")
      .select(
        "id, name, phone, contractor_category, contractor_subtype, status, contact_person, email, mailing_address, tax_id, specialty, note",
      )
      .order("name", { ascending: true }),
    supabase
      .from("service_providers")
      .select(
        "id, name, phone, service_subtype, status, contact_person, email, mailing_address, vehicle_type, plate_no, note",
      )
      .order("name", { ascending: true }),
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

  const contractorRow = (r: {
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
  const allContractors = contractorsRes.data ?? [];
  const contractors: RecordRow[] = allContractors
    .filter((r) => r.contractor_category === "contractor")
    .map(contractorRow);
  const dc: RecordRow[] = allContractors
    .filter((r) => r.contractor_category === "dc")
    .map(contractorRow);

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
      <AppHeader
        kicker="รายชื่อติดต่อ"
        title="รายชื่อผู้ติดต่อ"
        fullName={ctx.fullName}
        maxWidthClass={PAGE_MAX_W}
      />
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ContactsTabs
          clients={clients}
          suppliers={suppliers}
          contractors={contractors}
          dc={dc}
          serviceProviders={serviceProviders}
        />
      </div>
    </PageShell>
  );
}
