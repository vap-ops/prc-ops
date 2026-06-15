// Spec 99 — /contacts/vendors (ผู้ขาย + ผู้ให้บริการ): the vendors-you-pay group.
// Spec 101 — widened to back-office (PM/super + procurement). For procurement
// it renders SUPPLIERS ONLY (they can't read service providers) and rows do NOT
// link to the detail page (which shows the money-isolated bank block); they
// curate suppliers inline. PM/super get both tabs + detail links.
// No money column read here (bank is admin-only), user session.

import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES, BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/detail-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { ContactsTabs } from "@/components/features/contacts-tabs";
import type { RecordRow, RecordBadge } from "@/components/features/record-manager";
import { aggregateSupplierSpend, buildSupplierSpendBadges } from "@/lib/purchasing/supplier-spend";

export const metadata = { title: "ผู้ขายและผู้ให้บริการ" };

export default async function ContactsVendorsPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const isManager = PM_ROLES.includes(ctx.role);
  const supabase = await createServerSupabase();

  const suppliersRes = await supabase
    .from("suppliers")
    .select("id, name, phone, contact_person, email, mailing_address, tax_id, payment_terms, note")
    .order("name", { ascending: true });

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

  // Service providers are PM/super only (procurement's RLS excludes them).
  let serviceProviders: RecordRow[] = [];
  if (isManager) {
    const serviceRes = await supabase
      .from("service_providers")
      .select(
        "id, name, phone, service_subtype, status, contact_person, email, mailing_address, vehicle_type, plate_no, note",
      )
      .order("name", { ascending: true });
    serviceProviders = (serviceRes.data ?? []).map((r) => ({
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
  }

  // Spec 107: per-supplier spend chip for procurement (buyer intelligence).
  // amount is money → admin read, gated to the procurement branch. Bounded to
  // committed POs (purchased/on_route/delivered); a SQL group-by is the scale
  // refinement if the committed history ever exceeds the PostgREST cap.
  // Pass a SERIALIZABLE map (not a function) to the client ContactsTabs — a
  // function prop throws across the RSC boundary (spec 109 lesson; this was the
  // procurement-only crash on ผู้ขาย).
  let supplierBadges: Record<string, RecordBadge> | undefined;
  if (!isManager) {
    const admin = createAdminSupabase();
    const { data: prRows } = await admin
      .from("purchase_requests")
      .select("supplier_id, amount, status")
      .in("status", ["purchased", "on_route", "delivered"]);
    supplierBadges = buildSupplierSpendBadges(aggregateSupplierSpend(prRows ?? []));
  }

  const backHref = isManager ? "/settings" : "/requests";
  const backLabel = isManager ? "ตั้งค่า" : "คำขอซื้อ";
  const title = isManager ? "ผู้ขายและผู้ให้บริการ" : "ผู้ขาย";

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={backHref} backLabel={backLabel}>
        <h1 className="text-title text-ink font-bold tracking-tight">{title}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {isManager ? (
          <ContactsTabs group="vendors" suppliers={suppliers} serviceProviders={serviceProviders} />
        ) : (
          <ContactsTabs
            group="suppliers"
            suppliers={suppliers}
            linkDetails={false}
            {...(supplierBadges ? { supplierBadges } : {})}
          />
        )}
      </div>
    </PageShell>
  );
}
