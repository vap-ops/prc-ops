// Spec 268 — /equipment/rentals: record + list inbound equipment rental deals
// (the spec-146 batches/allocations backend, finally surfaced). MONEY page:
// gated to BACK_OFFICE_ROLES (the exact definer-gate audience), so a
// site_admin session never reaches it (spec 46 / ADR 0055 decision 6). The two
// money tables are zero-authenticated-grant — read via the ADMIN client after
// the gate; owner/project names read via the RLS client.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { RentalManager } from "@/components/features/equipment/rental-manager";
import { buildRentalView, type RentalRatePeriod } from "@/lib/equipment/rental-view";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { EQUIPMENT_RENTAL_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: EQUIPMENT_RENTAL_LABEL };

export default async function EquipmentRentalsPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const admin = createAdminSupabase();
  const [
    { data: supplierRows },
    { data: projectRows },
    { data: batchRows },
    { data: allocationRows },
  ] = await Promise.all([
    supabase.from("suppliers").select("id, name").order("name", { ascending: true }),
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    admin
      .from("equipment_rental_batches")
      .select("id, supplier_id, monthly_rate, rate_period, starts_on, ends_on, note, created_at"),
    admin
      .from("equipment_project_allocations")
      .select("id, batch_id, project_id, starts_on, ends_on")
      .order("starts_on", { ascending: true }),
  ]);

  const suppliers = supplierRows ?? [];
  const projects = projectRows ?? [];
  const rentals = buildRentalView(
    (batchRows ?? []).map((b) => ({
      id: b.id,
      supplierId: b.supplier_id ?? "",
      rate: b.monthly_rate,
      ratePeriod: b.rate_period as RentalRatePeriod,
      startsOn: b.starts_on,
      endsOn: b.ends_on,
      note: b.note,
      createdAt: b.created_at,
    })),
    (allocationRows ?? []).map((a) => ({
      id: a.id,
      batchId: a.batch_id,
      projectId: a.project_id,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
    })),
    suppliers,
    projects,
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/equipment" backLabel="อุปกรณ์">
        <h1 className="text-title text-ink font-bold tracking-tight">{EQUIPMENT_RENTAL_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <RentalManager
          suppliers={suppliers}
          projects={projects}
          rentals={rentals}
          defaultDate={bangkokTodayISO()}
        />
      </div>
    </PageShell>
  );
}
